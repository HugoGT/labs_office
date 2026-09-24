# Salidas pensadas para copiar y pegar: los pasos manuales del README y el
# workflow de despliegue se alimentan de estos valores.

output "static_ip" {
  description = "IP publica reservada. De ella se derivan los dos hostnames."
  value       = google_compute_address.office.address
}

output "app_host" {
  description = "Hostname del SPA, de Colyseus y de la ruta del token."
  value       = local.app_host
}

output "livekit_host" {
  description = "Hostname de la senalizacion de LiveKit."
  value       = local.lk_host
}

output "turn_host" {
  description = "Hostname dedicado del TURN (issue #19), separado del de senalizacion."
  value       = local.turn_host
}

output "app_url" {
  description = "URL de entrada para un navegador."
  value       = "https://${local.app_host}"
}

output "vite_colyseus_url" {
  description = "Valor exacto de VITE_COLYSEUS_URL con el que hay que construir la imagen del SPA."
  value       = "wss://${local.app_host}"
}

output "livekit_url" {
  description = "Valor exacto de LIVEKIT_URL para el servidor de Colyseus."
  value       = "wss://${local.lk_host}"
}

output "instance_name" {
  description = "Nombre de la VM, para gcloud compute ssh."
  value       = google_compute_instance.office.name
}

output "instance_zone" {
  description = "Zona de la VM, para gcloud compute ssh."
  value       = google_compute_instance.office.zone
}

output "artifact_registry" {
  description = "Prefijo completo de las imagenes: <registro>/<imagen>:<sha>."
  value       = local.registry_path
}

output "deployer_service_account" {
  description = "Cuenta que suplanta el CI. Va en el secreto/variable GCP_DEPLOYER_SA del repositorio."
  value       = google_service_account.deployer.email
}

output "workload_identity_provider" {
  description = "Nombre completo del proveedor OIDC. Va en el secreto/variable GCP_WORKLOAD_IDENTITY_PROVIDER del repositorio."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "secret_ids" {
  description = "Contenedores de secreto creados. Sus VALORES se cargan a mano (ver README)."
  value = {
    livekit_api_key    = google_secret_manager_secret.livekit_api_key.secret_id
    livekit_api_secret = google_secret_manager_secret.livekit_api_secret.secret_id
    db_password        = google_secret_manager_secret.db_password.secret_id
    # Cadena vacia mientras `enable_identity_admin_secret` este en false: el
    # contenedor no existe y no hay ningun valor que cargar.
    identity_admin = var.enable_identity_admin_secret ? google_secret_manager_secret.identity_admin[0].secret_id : ""
  }
}

output "recording_bucket" {
  description = "Recordings bucket (issues #5, #58). Egress uploads here; objects are deleted after var.recording_retention_days."
  value       = google_storage_bucket.recordings.name
}
