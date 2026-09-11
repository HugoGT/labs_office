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

variable "image_tag" {
  description = "Tag inicial de las imagenes (SHA de commit). Vacio en el primer apply porque todavia no hay nada publicado: la VM escribe la configuracion y no levanta contenedores hasta que el primer despliegue le pase un tag."
  type        = string
  default     = ""
}
