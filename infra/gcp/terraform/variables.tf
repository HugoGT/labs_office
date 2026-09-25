# Todo lo que cambia entre entornos vive aqui.
#
# Hoy solo existe `test` (produccion espera a que aterrice el login con Google,
# issue #8). El objetivo de parametrizar por `env` no es tener dos entornos ya,
# sino que el segundo sea un `terraform.tfvars` distinto y no una copia del
# modulo entero.

variable "project_id" {
  description = "Proyecto GCP donde vive el stack. OJO: es compartido con recursos ajenos a este repo."
  type        = string
}

variable "env" {
  description = "Entorno logico. Hoy solo se instancia 'test'."
  type        = string
  default     = "test"

  validation {
    # El nombre entra en nombres de recurso y en etiquetas de facturacion;
    # mayusculas o guiones bajos los rechaza GCP mas adelante, no aqui.
    condition     = can(regex("^[a-z][a-z0-9-]{0,15}$", var.env))
    error_message = "env debe ser minusculas, digitos y guiones, empezando por letra."
  }
}

variable "app_name" {
  description = "Prefijo de nombres y valor de la etiqueta de red. Sin guiones bajos: las etiquetas de red de GCE los prohiben."
  type        = string
  default     = "labs-office"
}

variable "region" {
  description = "Region de la IP estatica, del Artifact Registry y de los secretos."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zona de la VM. Debe pertenecer a var.region."
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "Tipo de maquina. e2-medium (2 vCPU / 4 GB) es el minimo con el que el SFU no compite con Caddy y el servidor de Node por CPU."
  type        = string
  default     = "e2-medium"
}

variable "boot_disk_size_gb" {
  description = "Disco de arranque. 20 GB porque las imagenes de contenedor mas el cache de Docker no caben con holgura en los 10 GB por defecto."
  type        = number
  default     = 20
}

variable "boot_disk_image" {
  description = "Familia de imagen del disco de arranque."
  type        = string
  default     = "debian-cloud/debian-12"
}

variable "github_repository" {
  description = "Repositorio 'owner/name' que puede suplantar a la cuenta de despliegue. Es la unica condicion que separa nuestro CI de cualquier repositorio de GitHub del mundo."
  type        = string
  default     = "HugoGT/labs_office"
}

variable "acme_email" {
  description = "Correo de contacto para Let's Encrypt/ZeroSSL. Solo recibe avisos de expiracion; no aparece en el certificado."
  type        = string
}

variable "auth_project_id" {
  description = "Proyecto de GCP Identity Platform que firma los ID tokens de email+password (issue #8). Vacio deja el servidor SIN autenticacion, que es como corrio hasta ahora: ponerlo es una decision explicita, porque a partir de ese momento solo entran cuentas que existan en ese proyecto. Normalmente coincide con project_id."
  type        = string
  default     = ""
}

variable "bootstrap_superadmin_email" {
  description = "Correo que se promociona a superadmin en su PRIMER inicio de sesion, y solo mientras el directorio no tenga ya un superadmin (issue #24). La cuenta tiene que existir antes en Identity Platform: el issue #8 desactivo el alta por cuenta propia, asi que un correo que nadie pueda usar para entrar deja la oficina sin nadie que pueda administrarla. Vacio: no hay arranque en frio."
  type        = string
  default     = ""

  validation {
    # Comprobacion deliberadamente laxa: solo descarta los errores que se ven
    # (un nombre de usuario suelto, un espacio de mas, un dominio sin punto).
    # Validar direcciones de correo de verdad no se puede desde aqui, y el
    # unico veredicto que cuenta es el de Identity Platform al firmar el token.
    condition     = var.bootstrap_superadmin_email == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.bootstrap_superadmin_email))
    error_message = "bootstrap_superadmin_email debe ser una direccion de correo (usuario@dominio.tld) o quedar vacio."
  }
}

variable "enable_identity_admin_secret" {
  description = "Crea el contenedor del secreto con la clave de cuenta de servicio de Identity Platform, la que el servidor usa para dar de alta cuentas al aceptar una invitacion (issue #24). Desactivado por defecto porque esa cuenta de servicio se crea a mano y puede no existir: sin ella el panel funciona entero salvo el endpoint de invitar, que responde 503. Activarlo solo crea el contenedor; el valor se anade despues con `gcloud secrets versions add`."
  type        = bool
  default     = false
}

variable "identity_admin_from_metadata" {
  description = "Hace que el servidor pida el token de Identity Platform al servidor de metadata de la VM, con la identidad que la maquina ya tiene, en vez de leerlo de una clave de cuenta de servicio (issue #24). Es la alternativa SIN claves, y existe porque la politica de organizacion 'constraints/iam.disableServiceAccountKeyCreation' puede prohibir crear esa clave: cuando esta aplicada no hay JSON que cargar en el secreto y este es el unico camino viable. Activarlo concede roles/identitytoolkit.admin a la cuenta de servicio de la VM; con la clave presente en el entorno, manda la clave."
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "Tag inicial de las imagenes (SHA de commit). Vacio en el primer apply porque todavia no hay nada publicado: la VM escribe la configuracion y no levanta contenedores hasta que el primer despliegue le pase un tag."
  type        = string
  default     = ""
}

variable "recording_retention_days" {
  description = "Days a recording lives in the bucket before the lifecycle rule deletes it (issues #5, #58). MUST equal RECORDING_RETENTION_DAYS in src/game/officeProtocol.ts: the app answers 410 recording-expired and shows \"Disponible hasta\" from that constant, and server/src/recording/retention.test.ts fails if the two drift."
  type        = number
  default     = 30

  validation {
    condition     = var.recording_retention_days >= 1
    error_message = "recording_retention_days must be at least 1."
  }
}

variable "db_tier" {
  description = "Cloud SQL machine tier for the directory database (issue #72). db-f1-micro is the smallest shared-core tier: enough for a few hundred rows in a test environment, with no SLA. Needs edition ENTERPRISE, which database.tf sets."
  type        = string
  default     = "db-f1-micro"
}

variable "db_psa_cidr" {
  description = "Private Service Access range on the default network, where the Cloud SQL private IP is allocated (issue #72). Must not overlap the VPC subnets (auto-mode default uses 10.128.0.0/9) nor the Docker bridges on the VM (172.17.0.0/16, 172.30.0.0/24)."
  type        = string
  default     = "10.100.0.0/20"

  validation {
    condition     = can(cidrhost(var.db_psa_cidr, 0)) && tonumber(split("/", var.db_psa_cidr)[1]) <= 24
    error_message = "db_psa_cidr must be a CIDR block of /24 or larger."
  }
}

variable "db_password_version" {
  description = "Bump to push a new Secret Manager version of the DB password to the Cloud SQL user (issue #72). The password itself is write-only and never stored in state; only this number is."
  type        = number
  # 2 since the test environment rotated the password to drop a trailing
  # newline (#72). Bump it here, not in terraform.tfvars, so every checkout
  # applies the same number and none pushes an older one back.
  default = 2
}
