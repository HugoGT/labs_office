# Observability (#275): one dashboard and three alerts in Cloud Monitoring.
#
# GCP-native on purpose, not a Prometheus and Grafana of our own: the Ops Agent
# on the VM (../ops-agent.yaml, installed by office-deploy) already ships VM and
# per-process metrics and scrapes the Prometheus endpoints of LiveKit, Egress
# and the office server, and Cloud Monitoring keeps them, draws them and
# alerts on them. Nothing else to run, patch or keep alive on a VM that is
# stopped every night. Requires monitoring.googleapis.com enabled (README,
# "Observability").
#
# Metrics written by the Ops Agent's Prometheus receiver (`prometheus.googleapis.com/*`)
# only exist after the first scrape, so everything reading them uses PromQL,
# which Cloud Monitoring does not check against existing metric descriptors.

locals {
  # Every policy notifies the same channel, or none while alert_email is empty.
  alert_channels = google_monitoring_notification_channel.email[*].id

  office_instance_filter = "resource.type = \"gce_instance\" AND resource.labels.instance_id = \"${google_compute_instance.office.instance_id}\""
}

resource "google_monitoring_notification_channel" "email" {
  count = var.alert_email == "" ? 0 : 1

  display_name = "Oficina virtual (${var.env})"
  type         = "email"
  user_labels  = local.labels

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_dashboard" "office" {
  dashboard_json = templatefile("${path.module}/dashboard.json.tftpl", {
    name        = local.name
    instance_id = google_compute_instance.office.instance_id
  })
}

# ---------------------------------------------------------------------------
# CPU alta sostenida
# ---------------------------------------------------------------------------

# Ten minutes, not one: a recording starting or a deploy pulling images spikes
# the CPU for a moment and is no reason to wake anyone. Sustained, it is what
# makes every call in the office sound robotic.
resource "google_monitoring_alert_policy" "cpu_high" {
  display_name          = "${local.name}: CPU alta sostenida"
  combiner              = "OR"
  notification_channels = local.alert_channels
  user_labels           = local.labels

  conditions {
    display_name = "CPU de la VM por encima del 85 % durante 10 minutos"

    condition_threshold {
      filter          = "${local.office_instance_filter} AND metric.type = \"compute.googleapis.com/instance/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "600s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "La VM de la oficina lleva 10 minutos por encima del 85 % de CPU: el audio y el video se degradan para todos. Mirar el panel \"CPU por contenedor\" del dashboard ${local.name}. Si es Egress, hay una grabacion en marcha; si es LiveKit, demasiada gente para el tamano de la VM (ver \"VM schedule\" en infra/gcp/README.md para subirla a e2-standard-8)."
  }
}

# ---------------------------------------------------------------------------
# LiveKit caido
# ---------------------------------------------------------------------------

# LiveKit answers 200 on `/` of its HTTP port, which Caddy serves on lk.* over
# 443 (Caddyfile). Checked from outside, so it fails the way a browser would:
# LiveKit dead, Caddy dead, certificate expired or the VM unreachable.
resource "google_monitoring_uptime_check_config" "livekit" {
  display_name     = "${local.name}-livekit"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA", "SOUTH_AMERICA", "EUROPE"]
  user_labels      = local.labels

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.lk_host
    }
  }
}

# The VM is stopped every evening and every weekend (VM schedule), and then the
# check fails all night. The second condition holds only while the instance
# reports uptime, i.e. runs, and AND makes the policy fire only when both hold:
# LiveKit down on a VM that is up.
resource "google_monitoring_alert_policy" "livekit_down" {
  display_name          = "${local.name}: LiveKit caido"
  combiner              = "AND"
  notification_channels = local.alert_channels
  user_labels           = local.labels

  conditions {
    display_name = "LiveKit no responde desde fuera durante 5 minutos"

    condition_threshold {
      filter          = "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${google_monitoring_uptime_check_config.livekit.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  conditions {
    display_name = "La VM esta encendida"

    condition_threshold {
      filter          = "${local.office_instance_filter} AND metric.type = \"compute.googleapis.com/instance/uptime\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "https://${local.lk_host}/ no responde con la VM encendida: nadie tiene audio ni video. Diagnostico: \"Diagnostico\" en infra/gcp/README.md (`docker compose ps` y `docker compose logs livekit caddy` en la VM por IAP)."
  }
}

# ---------------------------------------------------------------------------
# Disco casi lleno durante una grabacion
# ---------------------------------------------------------------------------

# Egress writes the recording on the VM disk before uploading it, and a full
# disk loses it. One PromQL condition (a PromQL policy takes no other): the
# boot disk above 85 % while the office server counts a recording running.
resource "google_monitoring_alert_policy" "disk_full_while_recording" {
  display_name          = "${local.name}: disco casi lleno durante una grabacion"
  combiner              = "OR"
  notification_channels = local.alert_channels
  user_labels           = local.labels

  conditions {
    display_name = "Disco por encima del 85 % con una grabacion en marcha"

    condition_prometheus_query_language {
      query               = "max(agent_googleapis_com:disk_percent_used{monitored_resource=\"gce_instance\", instance_id=\"${google_compute_instance.office.instance_id}\", state=\"used\"}) > 85 and on() max(office_recordings_active) > 0"
      duration            = "120s"
      evaluation_interval = "60s"
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "El disco de la VM esta por encima del 85 % y hay una grabacion en marcha: si se llena, la grabacion se pierde. Liberar espacio en la VM (`docker image prune -af`, `docker system df`) o parar la grabacion desde la oficina."
  }
}
