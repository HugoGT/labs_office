# Directory database on Cloud SQL (issue #72).
#
# Until #72 Postgres ran as a container on the VM boot disk, the only disk. A
# `terraform apply` that replaced the VM (2026-09-21) wiped `users` and
# `audit_log` with it, and there were no backups. The directory now lives in a
# managed instance that survives VM replacement and takes automated backups
# with point-in-time recovery.
#
# Private IP only, through Private Service Access on the `default` network: the
# instance never gets a public address, so the only way in is from inside the
# VPC. The VM reaches it directly over the peering; no Cloud SQL Auth Proxy, so
# the VM service account needs no `roles/cloudsql.client` (that role only
# matters for the proxy, the connectors and IAM database auth).

# ---------------------------------------------------------------------------
# APIs
# ---------------------------------------------------------------------------

# `disable_on_destroy = false` is mandatory here, not a preference: the GCP
# project is SHARED. Destroying this stack must never switch off an API that a
# foreign resource in the same project may depend on.
resource "google_project_service" "sqladmin" {
  project                    = var.project_id
  service                    = "sqladmin.googleapis.com"
  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_project_service" "servicenetworking" {
  project                    = var.project_id
  service                    = "servicenetworking.googleapis.com"
  disable_on_destroy         = false
  disable_dependent_services = false
}

# ---------------------------------------------------------------------------
# Private Service Access on the default network
# ---------------------------------------------------------------------------

data "google_compute_network" "default" {
  name = "default"
}

# The range Google carves the instance's private IP from. Pinned instead of
# auto-allocated: the VM runs Docker, whose bridges live in 172.17.0.0/16 and
# 172.30.0.0/24 (docker-compose.yml). An auto-allocated range that overlapped
# either would make the VM route Cloud SQL traffic into a local bridge, with a
# connection timeout that points nowhere near the cause. The default is also
# outside 10.128.0.0/9, where auto-mode `default` subnets live.
resource "google_compute_global_address" "sql_psa" {
  name          = "${local.name}-sql-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = split("/", var.db_psa_cidr)[0]
  prefix_length = tonumber(split("/", var.db_psa_cidr)[1])
  network       = data.google_compute_network.default.id
  labels        = local.labels
}

# There is ONE service networking connection per network, shared by every
# producer service. See the README pre-check before the first apply: if the
# shared project already has one on `default`, this resource must be imported
# with the existing ranges added, never created over it.
#
# ABANDON on destroy: deleting the peering would cut off any other private
# service that ends up using it, and a `terraform destroy` of this stack has no
# business doing that.
resource "google_service_networking_connection" "sql" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_psa.name]
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.servicenetworking]
}

# ---------------------------------------------------------------------------
# Instance, database and user
# ---------------------------------------------------------------------------

resource "google_sql_database_instance" "directory" {
  name             = "${local.name}-db"
  region           = var.region
  database_version = "POSTGRES_17"

  # Terraform-side guard: `terraform destroy` or a replacing change fails
  # instead of deleting the directory. `deletion_protection_enabled` below is
  # the API-side twin, which also stops a delete from the console or gcloud.
  deletion_protection = true

  settings {
    # PostgreSQL 16+ defaults to the Enterprise Plus edition, which has no
    # shared-core tiers. The directory is a few hundred rows; Enterprise with
    # a small tier is what a test environment needs.
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true
    user_labels       = local.labels

    deletion_protection_enabled = true

    # Backups taken before a deletion are kept instead of being deleted with
    # the instance. The whole point of #72 is that losing the host must not
    # lose the data.
    retain_backups_on_delete = true

    location_preference {
      zone = var.zone
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.default.id
      # TLS is required even inside the VPC: without it, emails and roles
      # would cross the peering in clear text. The server verifies the
      # instance's own CA (DATABASE_SSL_CA_FILE, see server/src/directory/
      # pool.ts), which Terraform hands to the VM through metadata.
      ssl_mode = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      # 08:00 UTC is 03:00 in Lima, when nobody is in the office.
      start_time                     = "08:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 8 # UTC
      update_track = "stable"
    }
  }

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.sql,
  ]
}

resource "google_sql_database" "office" {
  name     = "office"
  instance = google_sql_database_instance.directory.name

  # Terraform destroys dependents first: without this, a destroy (or an apply
  # from a commit that predates this file) would DROP the database, and only
  # then hit the instance's deletion protection and fail. ABANDON leaves the
  # data where it is.
  deletion_policy = "ABANDON"
}

# The password comes from the SAME Secret Manager secret office-deploy reads to
# build DATABASE_URL, so the two sides cannot drift. It never lands in the
# Terraform state or plan:
#
#   - `ephemeral` resources are never persisted (a `data` source would store
#     `secret_data` in the state in clear text);
#   - `password_wo` is a write-only argument, nulled before the state is
#     written. Only `password_wo_version` is stored.
#
# Both need Terraform >= 1.11 (see versions.tf). The secret must already have a
# version when this is planned; see the README.
#
# `trimspace` because a secret added with `echo` or plain `openssl rand` ends in
# a newline: Terraform would set it on the user, while office-deploy drops it
# (bash `$(...)` and its own strip), and every login fails with `password
# authentication failed`. Both sides trim the same whitespace.
#
# To rotate: add a new secret version, bump `db_password_version`, apply, then
# redeploy so office-deploy rewrites DATABASE_URL.
ephemeral "google_secret_manager_secret_version" "db_password" {
  secret = google_secret_manager_secret.db_password.secret_id
}

resource "google_sql_user" "office" {
  name     = "office"
  instance = google_sql_database_instance.directory.name

  password_wo         = trimspace(ephemeral.google_secret_manager_secret_version.db_password.secret_data)
  password_wo_version = var.db_password_version

  # A PostgreSQL role that owns objects cannot be dropped, so a delete would
  # fail halfway through a destroy anyway. The instance's deletion protection
  # is what guards the data; this only keeps a destroy from erroring here.
  deletion_policy = "ABANDON"
}
