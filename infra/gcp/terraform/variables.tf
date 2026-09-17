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

variable "image_tag" {
  description = "Tag inicial de las imagenes (SHA de commit). Vacio en el primer apply porque todavia no hay nada publicado: la VM escribe la configuracion y no levanta contenedores hasta que el primer despliegue le pase un tag."
  type        = string
  default     = ""
}
