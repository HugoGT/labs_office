# Stack de despliegue de la oficina virtual en GCP (issue #3).
#
# Una sola VM corre los cinco contenedores (el quinto, Postgres, lo trae el
# issue #24: cabe en la misma maquina y evita la factura de Cloud SQL, a cambio
# de copias de seguridad manuales). La razon de la VM es el SFU: LiveKit
# necesita UDP (media WebRTC y TURN) y Cloud Run solo habla HTTP/1.x y HTTP/2
# sobre TLS, asi que el SFU obliga a una VM de todas formas. Partir Colyseus y
# el SPA a Cloud Run habria significado dos superficies de despliegue, dos
# formas de leer logs y una factura extra para salvar un proceso de Node que
# cabe de sobra en la misma maquina.
#
# ATENCION: el proyecto GCP es COMPARTIDO. Aloja una VM ajena (`engram-cloud`),
# un bucket y secretos que NO pertenecen a este repo. Nada de lo que hay aqui
# los referencia, importa ni gestiona, y los permisos se conceden a nivel de
# recurso (no de proyecto) siempre que GCP lo permite, precisamente para que un
# fallo nuestro no pueda alcanzarlos.

locals {
  name = "${var.app_name}-${var.env}"

  # Las etiquetas de red (`tags`) NO aparecen en la facturacion; las etiquetas
  # de recurso (`labels`) si. Van en todo lo que cuesta dinero para poder
  # separar el gasto de este proyecto del resto del proyecto GCP compartido.
  labels = {
    app = var.app_name
    env = var.env
  }

  # Etiqueta de red con la que se acotan TODAS las reglas de firewall. Copia la
  # convencion que ya existe en el proyecto (`engram-allow-web` esta acotada con
  # el tag `engram-cloud`), y es lo unico que impide que abrir un puerto aqui
  # abra tambien ese puerto en la VM ajena.
  #
  # Lleva el sufijo de entorno a proposito. Con el nombre pelado (`labs-office`)
  # una futura VM de produccion heredaria en silencio las reglas de test en
  # cuanto alguien le pusiera el mismo tag, que es exactamente el tipo de fallo
  # que no avisa: el firewall no se queja, simplemente abre de mas. La etiqueta
  # de facturacion (`labels.app`) si se queda sin sufijo, porque ahi lo que se
  # quiere es justo lo contrario: sumar el gasto de todos los entornos.
  network_tag = local.name

  # sslip.io resuelve <lo-que-sea>.<ip-con-guiones>.sslip.io a esa misma IP.
  # Es lo que permite tener hostname y certificado sin dominio propio.
  dashed_ip = replace(google_compute_address.office.address, ".", "-")
  app_host  = "app.${local.dashed_ip}.sslip.io"
  lk_host   = "lk.${local.dashed_ip}.sslip.io"
  # Hostname dedicado del TURN (issue #19), distinto del de senalizacion. Es
  # lo que permite que el multiplexor del Caddyfile separe TURN de la
  # senalizacion mirando solo el SNI del ClientHello.
  turn_host = "turn.${local.dashed_ip}.sslip.io"

  registry_host = "${var.region}-docker.pkg.dev"
  registry_path = "${local.registry_host}/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

# ---------------------------------------------------------------------------
# Red: IP estatica y firewall
# ---------------------------------------------------------------------------

# La IP reservada NO es un lujo: el hostname se deriva de ella via sslip.io, asi
# que una IP efimera cambiaria la URL en cada reinicio y dejaria invalido el
# certificado TLS emitido para el hostname anterior.
resource "google_compute_address" "office" {
  name         = "${local.name}-ip"
  region       = var.region
  address_type = "EXTERNAL"
  labels       = local.labels

  # Reservar la IP es barato; perderla obliga a reemitir certificados y a
  # avisar a todo el mundo de la nueva URL.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_firewall" "web" {
  name        = "${local.name}-web"
  network     = "default"
  description = "HTTP para el desafio ACME y HTTPS/WSS para la app."

  # 80 no se puede cerrar aunque todo el trafico util vaya por 443: el desafio
  # HTTP-01 de Let's Encrypt entra por el puerto 80 y sin el Caddy no puede
  # emitir ni renovar los certificados.
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.network_tag]
}

resource "google_compute_firewall" "rtc" {
  name        = "${local.name}-rtc"
  network     = "default"
  description = "Media WebRTC: rango UDP del SFU y su fallback sobre TCP."

  # El camino normal. Un puerto por conexion de media, de ahi el rango.
  allow {
    protocol = "udp"
    ports    = ["50000-60000"]
  }

  # Fallback cuando la red del cliente bloquea UDP por completo. Sin el, esos
  # usuarios simplemente no oyen a nadie.
  allow {
    protocol = "tcp"
    ports    = ["7881"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.network_tag]
}

resource "google_compute_firewall" "turn" {
  name        = "${local.name}-turn"
  network     = "default"
  description = "TURN embebido de LiveKit, para NAT simetricos que no dejan pasar ICE directo."

  allow {
    protocol = "udp"
    ports    = ["3478"]
  }

  allow {
    protocol = "tcp"
    ports    = ["5349"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.network_tag]
}

resource "google_compute_firewall" "ssh_iap" {
  name        = "${local.name}-ssh-iap"
  network     = "default"
  description = "SSH solo desde el tunel IAP de Google, nunca desde internet."

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # 35.235.240.0/20 es el rango publicado desde el que IAP origina los tuneles.
  # Abrir 22 a 0.0.0.0/0 significaria exponer sshd al escaneo constante de
  # internet a cambio de nada: el unico cliente que necesita entrar es el
  # workflow de despliegue, y ese ya pasa por IAP para autenticarse con
  # identidad de Google en vez de con una clave.
  #
  # Nota: el proyecto tiene ademas una regla PREEXISTENTE `default-allow-ssh`
  # que abre 22 desde 0.0.0.0/0 sin target tags. No se toca aqui a proposito:
  # afecta tambien a la VM ajena y no es nuestra para cambiarla. Esta regla no
  # depende de ella; simplemente no confiamos en ella.
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [local.network_tag]
}

# ---------------------------------------------------------------------------
# Artifact Registry
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = local.name
  format        = "DOCKER"
  description   = "Imagenes de la oficina virtual, etiquetadas por SHA de commit."
  labels        = local.labels
}

# ---------------------------------------------------------------------------
# Secretos
# ---------------------------------------------------------------------------

# Terraform crea el CONTENEDOR del secreto, nunca su contenido. Meter el valor
# aqui lo dejaria en el fichero de estado en texto plano, que es justo el
# problema que Secret Manager resuelve. Las versiones se anaden a mano una vez
# (`gcloud secrets versions add`, ver README) y Terraform no las declara, asi
# que jamas intentara borrarlas ni sobrescribirlas.
resource "google_secret_manager_secret" "livekit_api_key" {
  secret_id = "${local.name}-livekit-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  lifecycle {
    # Alias y anotaciones los puede tocar quien administre el secreto a mano;
    # que Terraform los revierta en el siguiente apply seria una sorpresa.
    ignore_changes = [version_aliases, annotations]
  }
}

resource "google_secret_manager_secret" "livekit_api_secret" {
  secret_id = "${local.name}-livekit-api-secret"
  labels    = local.labels

  replication {
    auto {}
  }

  lifecycle {
    ignore_changes = [version_aliases, annotations]
  }
}

# Contrasena del Postgres que corre como un contenedor mas en la VM (issue #24).
# Mismo trato que las claves de LiveKit: Terraform crea el contenedor y el valor
# se anade a mano una vez. Ojo con una diferencia que no tienen las otras dos:
# Postgres solo lee esta contrasena cuando inicializa el volumen por primera
# vez, asi que cambiar la version del secreto mas adelante NO cambia la del
# servidor y deja al servidor sin poder conectarse.
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${local.name}-db-password"
  labels    = local.labels

  replication {
    auto {}
  }

  lifecycle {
    ignore_changes = [version_aliases, annotations]
  }
}

# Clave de la cuenta de servicio con la que el servidor da de alta cuentas en
# Identity Platform al aceptar una invitacion (issue #24).
#
# Opcional a proposito, y por eso el `count`: la cuenta de servicio hay que
# crearla a mano en la consola y puede no existir todavia. Sin ella el panel
# funciona entero salvo el endpoint de invitar, que responde 503. Crear el
# contenedor del secreto igualmente no costaria dinero, pero dejaria un secreto
# vacio y permanente en un proyecto GCP que es compartido, y "esta ahi pero no
# vale nada" es peor que no estar.
resource "google_secret_manager_secret" "identity_admin" {
  count = var.enable_identity_admin_secret ? 1 : 0

  secret_id = "${local.name}-identity-admin"
  labels    = local.labels

  replication {
    auto {}
  }

  lifecycle {
    ignore_changes = [version_aliases, annotations]
  }
}

# ---------------------------------------------------------------------------
# Identidad de la VM
# ---------------------------------------------------------------------------

# Cuenta dedicada en vez de la cuenta por defecto de Compute: la de por defecto
# nace con roles/editor sobre TODO el proyecto, y este proyecto tiene recursos
# ajenos dentro.
resource "google_service_account" "vm" {
  account_id   = "${local.name}-vm"
  display_name = "VM de la oficina virtual (${var.env})"
}

# Acceso a secretos concedido SECRETO A SECRETO, no a nivel de proyecto.
# roles/secretmanager.secretAccessor sobre el proyecto le daria a esta VM
# lectura sobre los secretos ajenos que ya viven aqui.
resource "google_secret_manager_secret_iam_member" "vm_livekit_api_key" {
  secret_id = google_secret_manager_secret.livekit_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_secret_manager_secret_iam_member" "vm_livekit_api_secret" {
  secret_id = google_secret_manager_secret.livekit_api_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_secret_manager_secret_iam_member" "vm_db_password" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

# Acompana al `count` del secreto: sin secreto no hay a que conceder nada.
resource "google_secret_manager_secret_iam_member" "vm_identity_admin" {
  count = var.enable_identity_admin_secret ? 1 : 0

  secret_id = google_secret_manager_secret.identity_admin[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

# Igual que arriba: lectura acotada a NUESTRO repositorio de imagenes.
resource "google_artifact_registry_repository_iam_member" "vm_reader" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

# Este si va a nivel de proyecto porque Cloud Logging no tiene un recurso mas
# fino al que atarlo. logWriter solo permite escribir entradas, no leerlas.
resource "google_project_iam_member" "vm_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

# ---------------------------------------------------------------------------
# VM
# ---------------------------------------------------------------------------

resource "google_compute_instance" "office" {
  name         = local.name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = [local.network_tag]
  labels       = local.labels

  # Los cambios de metadata (fichero compose, Caddyfile, scripts) requieren
  # parar la instancia en algunos casos; sin esto el apply falla en vez de
  # aplicarlos.
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image  = var.boot_disk_image
      size   = var.boot_disk_size_gb
      type   = "pd-balanced"
      labels = local.labels
    }
  }

  network_interface {
    network = "default"

    access_config {
      nat_ip = google_compute_address.office.address
    }
  }

  service_account {
    email = google_service_account.vm.email
    # cloud-platform y que sean los roles IAM los que acoten: los scopes son el
    # mecanismo antiguo y mezclarlos con IAM produce denegaciones dificiles de
    # diagnosticar (el rol concede, el scope niega).
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata_startup_script = file("${path.module}/../startup-script.sh")

  metadata = {
    # OS Login: las claves SSH las gestiona IAM en vez de vivir en la metadata
    # del proyecto. Es lo que permite que el despliegue entre con la identidad
    # federada de GitHub y no con una clave privada guardada en un secreto.
    enable-oslogin = "TRUE"

    # La configuracion viaja por metadata en vez de estar horneada en la imagen
    # o clonada desde git en la VM: asi un `terraform apply` es suficiente para
    # cambiarla, la VM no necesita credenciales de git, y el script de
    # despliegue puede releerla sin reiniciar la maquina.
    office-compose        = file("${path.module}/../docker-compose.yml")
    office-caddyfile      = file("${path.module}/../Caddyfile")
    office-livekit-config = file("${path.module}/../livekit.yaml.tpl")
    office-deploy-script  = file("${path.module}/../scripts/office-deploy.sh")

    office-project-id         = var.project_id
    office-registry           = local.registry_path
    office-app-host           = local.app_host
    office-lk-host            = local.lk_host
    # Issue #19. LiveKit deja de leer certificados de Caddy (turn.external_tls)
    # y por eso ya no hace falta el vigilante que los reiniciaba: no hay
    # equivalente a office-cert-script aqui.
    office-turn-host          = local.turn_host
    office-acme-email         = var.acme_email
    office-secret-key         = google_secret_manager_secret.livekit_api_key.secret_id
    office-secret-secret      = google_secret_manager_secret.livekit_api_secret.secret_id
    office-secret-db-password = google_secret_manager_secret.db_password.secret_id

    # Vacia cuando la cuenta de servicio de Identity Platform no esta montada.
    # `office-deploy` lee esta clave con `|| true` y, si no hay nombre, ni
    # siquiera intenta la lectura del secreto.
    office-secret-identity-admin = var.enable_identity_admin_secret ? google_secret_manager_secret.identity_admin[0].secret_id : ""

    # No es un secreto y por eso no pasa por Secret Manager: es el id de un
    # proyecto de GCP, publico por naturaleza. Lo que protege la oficina son las
    # cuentas de ese proyecto y la verificacion de la firma en el servidor.
    office-auth-project-id = var.auth_project_id

    # Tampoco es un secreto, por el mismo criterio: es una direccion de correo.
    # Conocerla no da acceso a nada; la promocion a superadmin exige ademas
    # iniciar sesion con una cuenta verificada de Identity Platform que tenga
    # ese correo, y solo mientras no exista ya un superadmin (issue #24).
    office-bootstrap-superadmin-email = var.bootstrap_superadmin_email

    # Vacio en el primer apply: todavia no hay imagenes publicadas. El script de
    # arranque escribe la configuracion y se detiene sin levantar nada hasta que
    # el primer despliegue le pasa un SHA.
    office-image-tag = var.image_tag
  }
}

# ---------------------------------------------------------------------------
# Identidad de despliegue (CI) y federacion con GitHub
# ---------------------------------------------------------------------------

resource "google_service_account" "deployer" {
  account_id   = "${local.name}-deployer"
  display_name = "Despliegue desde GitHub Actions (${var.env})"
}

# El pool y el proveedor sustituyen a una clave JSON en los secretos de GitHub.
# Una clave JSON no caduca, no se puede acotar por repositorio y quien la lea
# una vez la tiene para siempre; la federacion emite credenciales de minutos
# ligadas al token OIDC que GitHub firma para cada ejecucion.
#
# Cuidado al destruir: los IDs de pool y de proveedor quedan reservados 30 dias
# despues de borrarlos, asi que un destroy+apply seguido falla por ID en uso.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "${local.name}-gh"
  display_name              = "GitHub Actions (${var.env})"
  description               = "Identidades federadas de GitHub Actions para desplegar la oficina virtual."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  # ESTA LINEA ES LA SEGURIDAD DE TODO EL MECANISMO. Sin la condicion, el
  # proveedor acepta el token OIDC de CUALQUIER repositorio de GitHub del mundo
  # y cualquiera puede suplantar a la cuenta de despliegue creando un workflow
  # propio. La condicion se evalua antes de emitir el token de GCP.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# La segunda mitad del cerrojo: solo los tokens cuyo `attribute.repository`
# coincide con nuestro repo pueden suplantar a la cuenta de despliegue.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Escritura acotada a nuestro repositorio de imagenes.
resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# Tunel IAP acotado A LA INSTANCIA. Concedido a nivel de proyecto permitiria
# tunelizar tambien hacia la VM ajena, que es exactamente lo que no queremos.
resource "google_iap_tunnel_instance_iam_member" "deployer" {
  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.office.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# osAdminLogin y no osLogin porque el script de despliegue escribe en
# /opt/office (incluido el fichero de entorno 0600 de root) y habla con el
# socket de Docker: sin sudo no puede hacer ninguna de las dos cosas. Sigue
# siendo mucho menos que roles/compute.instanceAdmin.v1, que permitiria
# reconfigurar o borrar instancias, y esta acotado A ESTA INSTANCIA.
resource "google_compute_instance_iam_member" "deployer_os_admin_login" {
  project       = var.project_id
  zone          = var.zone
  instance_name = google_compute_instance.office.name
  role          = "roles/compute.osAdminLogin"
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

# `gcloud compute ssh` necesita leer la instancia antes de abrir el tunel.
# roles/compute.viewer serviria, pero da lectura sobre TODO el proyecto
# (incluida la metadata de la VM ajena). Este rol a medida tiene un unico
# permiso y se ata solo a nuestra instancia.
resource "google_project_iam_custom_role" "instance_read" {
  role_id     = "${replace(local.name, "-", "_")}_instance_read"
  title       = "Lectura de la instancia de la oficina virtual (${var.env})"
  description = "Minimo que gcloud compute ssh necesita para resolver la instancia antes de tunelizar."
  permissions = ["compute.instances.get"]
}

resource "google_compute_instance_iam_member" "deployer_instance_read" {
  project       = var.project_id
  zone          = var.zone
  instance_name = google_compute_instance.office.name
  role          = google_project_iam_custom_role.instance_read.id
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

# gcloud consulta ademas el proyecto (para saber si OS Login esta activo) y la
# zona. Son lecturas de metadatos de configuracion, sin acceso a datos, y no
# existe un recurso mas fino al que atarlas.
resource "google_project_iam_custom_role" "project_read" {
  role_id     = "${replace(local.name, "-", "_")}_project_read"
  title       = "Lectura de proyecto para el despliegue (${var.env})"
  description = "Lo minimo que gcloud compute ssh consulta a nivel de proyecto y zona."
  permissions = [
    "compute.projects.get",
    "compute.zones.get",
    "compute.zones.list",
  ]
}

resource "google_project_iam_member" "deployer_project_read" {
  project = var.project_id
  role    = google_project_iam_custom_role.project_read.id
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# No hace falta para el despliegue por SSH que hay hoy: serviceAccountUser
# autoriza a ADJUNTAR esta cuenta a un recurso nuevo, cosa que ocurriria si el
# workflow llegase a recrear la VM. Se concede acotado a la cuenta de la VM (no
# a nivel de proyecto) para que no pueda usarse con ninguna otra identidad.
resource "google_service_account_iam_member" "deployer_uses_vm_sa" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
