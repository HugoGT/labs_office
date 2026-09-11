# Pines de Terraform y del proveedor.
#
# El proveedor se fija a la linea 7.x con `~>`: los saltos de major de
# google-beta/google renombran atributos sin aviso y un `terraform apply`
# no reproducible sobre infraestructura compartida es exactamente el riesgo
# que este proyecto no puede correr (el proyecto GCP aloja ademas recursos
# ajenos que no gestionamos).

terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.9"
    }
  }

  # Estado remoto en GCS.
  #
  # Queda comentado a proposito: el bucket no se puede crear desde este mismo
  # estado (seria una dependencia circular, el backend se resuelve antes que
  # cualquier recurso). El README documenta el `gcloud storage buckets create`
  # de una sola vez; despues se descomenta este bloque y se corre
  # `terraform init -migrate-state`.
  #
  backend "gcs" {
    bucket = "labs-office-tfstate"
    prefix = "test"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
