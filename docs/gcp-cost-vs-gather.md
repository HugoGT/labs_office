# Costo mensual en GCP frente a Gather (50-60 personas)

Fecha de la estimación: 2026-11-06. Moneda: USD. Región: `us-central1` (Iowa). Proyecto: `vaulted-channel-505114-f0`.

Este documento estima cuánto cuesta al mes el entorno desplegado `test` para una oficina de 50-60 personas y lo compara con pagar Gather para el mismo equipo.

> **Estado de verificación de precios.** Las páginas oficiales de precios de Google Cloud se generan de forma dinámica y no se pudieron leer de forma automática. Solo los datos marcados como **oficial** se leyeron en páginas de Google o de Gather. El resto proviene de agregadores de terceros (**tercero**) o **no está verificado**. Confírmelos en la [calculadora de precios de Google Cloud](https://cloud.google.com/products/calculator) antes de comprometer presupuesto.

## Resumen

| Opción | Costo fijo | Egress | **Total al mes** |
|---|---|---|---|
| Labs en GCP, **uso medido (tráfico estimado)** con la junta del viernes real (218 GiB) | 65,40 | 41,40 | **106,80** |
| Labs en GCP, **uso fuerte (poco probable)** (~447 GiB) | 65,40 | 85,00 | **150,40** |
| Gather Essential, 60 miembros, pago anual | 576,00 | incluido | **576,00** |
| Gather Essential, 60 miembros, pago mensual | 720,00 | incluido | **720,00** |

Conclusiones:

- **Con uso pleno, labs cuesta entre 74 % y 85 % menos que Gather.** Con 60 miembros, Gather cuesta entre 3,8 y 6,7 veces más que labs en los dos escenarios.
- **El egress es el único costo que crece con el uso.** Cada hora de junta del viernes (VDC) con 50 personas suma unos ~9 USD. En el escenario de uso fuerte, el egress es algo más de la mitad de la factura.
- **El costo fijo es bajo porque la VM solo corre en horario de oficina** (265 de las 730 horas del mes).
- **No incluido en labs:** el tiempo de ingeniería para construir y mantener la oficina. El precio de Gather incluye ese trabajo.

## Arquitectura y dimensionamiento

| Recurso | Función | Tamaño | Funciona |
|---|---|---|---|
| VM `labs-office-test` | SPA, servidor Node (Colyseus y API), LiveKit, Egress, Redis y Caddy con Docker Compose | `e2-standard-4` de lunes a jueves, `e2-standard-8` los viernes (#278) | Días laborables de 07:45 a 20:00, hora de Lima |
| Disco de arranque | Debian 12 y los contenedores | 20 GB `pd-balanced` | Se cobra siempre |
| IPv4 externa estática | `app.*`, `lk.*` y `turn.*` con sslip.io | 1 | Se cobra siempre |
| Cloud SQL | Directorio, espacios, escritorios y decoración (PostgreSQL 17, Enterprise) | `db-f1-micro`, 10 GB SSD, zonal, backups con 7 días de PITR | 24/7 |
| Cloud Storage | Grabaciones, que se borran a los 30 días | Standard, `US-CENTRAL1` | Siempre |
| Artifact Registry, Secret Manager, Monitoring, Logging | Imágenes por despliegue, secretos, panel, uptime check y alertas | Pequeño | Siempre |

Tamaños tomados de `infra/gcp/terraform/` y de `tools/vm/vmSchedule.ts`. La prueba de carga del 2026-11-06 mostró que `e2-standard-8` soporta una junta de 60 personas con 14 videos y grabación al ~75 % de CPU (`docs/labs-vm-capacity.md`).

## Supuestos

- 52 / 12 = 4,33 semanas por mes.
- Lunes a jueves: 12,25 h al día x 4 días = 212,33 h al mes en `e2-standard-4`.
- Viernes: 12,25 h x 4,33 = 53,08 h al mes en `e2-standard-8`.
- La VM está encendida 265,42 h al mes y detenida 464,58 h.
- Una junta grabada de 1 h a la semana.
- No se incluyen impuestos, soporte pagado, descuentos por compromiso de uso ni créditos.

## Precios unitarios y fuentes

Consulta realizada el 2026-11-06.

| Concepto | Precio usado (`us-central1`) | Estado | Fuente |
|---|---|---|---|
| `e2-standard-4` | 0,134 USD/h | Tercero | [gcloud-compute.com](https://gcloud-compute.com/e2-standard-4.html) |
| `e2-standard-8` | 0,268 USD/h | Tercero | [gcloud-compute.com](https://gcloud-compute.com/e2-standard-8.html) |
| Disco `pd-balanced` | 0,10 USD/GB-mes | Tercero | [gcloud-compute.com](https://gcloud-compute.com/diskpricing.html) |
| IPv4 externa en uso | 0,005 USD/h | No verificado | [Precios de red](https://cloud.google.com/vpc/network-pricing) (no legible automáticamente) |
| IPv4 estática con la VM detenida | 0,01 USD/h | No verificado. Las fuentes discrepan entre 0,005 y 0,01; se usa la más alta | [DoiT](https://www.doit.com/blog/no-more-free-external-ips-on-google-cloud-how-much-will-it-cost-you) |
| Cloud SQL `db-f1-micro` | 0,015 USD/h | Tercero. Las fuentes van de 0,011 a 0,018; se usa un valor intermedio | [Spare Cores](https://sparecores.com/database/gcp/db-f1-micro), [Bytebase](https://www.bytebase.com/dbcost/cloudsql/instance/db-f1-micro/) |
| Almacenamiento SSD de Cloud SQL | 0,17 USD/GB-mes | Tercero | [Bytebase](https://www.bytebase.com/dbcost/cloudsql-pricing/) |
| Cloud Storage Standard | 0,020 USD/GB-mes | No verificado | [Precios de Cloud Storage](https://cloud.google.com/storage/pricing) |
| Egress Premium Tier hacia Sudamérica | 0,19 USD/GiB (0-1 TiB) | **Oficial** | [Anuncio de precios de VPC](https://cloud.google.com/vpc/pricing-announce) |
| Gather Essential | 12 USD por miembro al mes; 20 % menos con pago anual (9,60) | **Oficial** | [Precios de Gather](https://www.gather.town/pricing) |

Las máquinas E2 no reciben descuentos por uso sostenido, así que el costo de cómputo es lineal con las horas encendidas ([oficial](https://docs.cloud.google.com/compute/docs/sustained-use-discounts)).

## Costo fijo

| Concepto | Cálculo | USD/mes |
|---|---|---|
| VM de lunes a jueves (`e2-standard-4`) | 0,134 x 212,33 | 28,45 |
| VM los viernes (`e2-standard-8`) | 0,268 x 53,08 | 14,23 |
| Disco de arranque (se cobran las 730 h) | 20 GB x 0,10 | 2,00 |
| IPv4 estática (265,42 h en uso y 464,58 h detenida) | 265,42 x 0,005 + 464,58 x 0,01 | 5,97 |
| Instancia de Cloud SQL (24/7) | 0,015 x 730 | 10,95 |
| Almacenamiento de Cloud SQL | 10 GB x 0,17 | 1,70 |
| Grabaciones en Cloud Storage | ~5 GB retenidos (1,2 GB/h, 30 días) x 0,020 | 0,10 |
| Artifact Registry, Secret Manager, Monitoring, Logging | Margen, sin desglosar | 2,00 |
| **Subtotal fijo** | | **65,40** |

Usar `e2-standard-8` los viernes en lugar de `e2-standard-4` cuesta 7,11 USD al mes (53,08 h x 0,134). Artifact Registry no tiene política de limpieza, así que las imágenes de cada despliegue se acumulan; revise su tamaño si el margen parece bajo.

## Egress

El egress es el tráfico que **sale** de Google Cloud hacia internet. Casi todo es el audio y video que LiveKit envía a cada persona. El tráfico entrante es gratis. Se factura a 0,19 USD/GiB porque los usuarios están en Sudamérica y la VM usa Premium Tier.

### Medido en los últimos 30 días

Fuente: métrica `compute.googleapis.com/instance/network/sent_bytes_count` de la VM en Cloud Monitoring, sumada por día, del 2026-10-08 al 2026-11-06.

| Período | GiB | Origen |
|---|---|---|
| 2026-10-13 | 11,04 | Prueba de carga en `e2-standard-4` |
| 2026-11-06 | 34,32 | Prueba de carga en `e2-standard-8` y la sesión de quienes la acompañaron |
| Resto de los días | ~1,8 | Uso normal: casi todos los días laborables por debajo de 0,05 GiB |
| **Total** | **47,2** | |

El uso diario de la oficina casi no genera tráfico de video. Esta métrica incluye también tráfico que no se factura como egress a internet (Cloud SQL, subida de grabaciones a Cloud Storage en la misma región, la VM generadora de la prueba en la misma región), así que la cifra real facturable es igual o menor.

### Proyección con uso pleno

**Medido por persona:** en la prueba de carga del 2026-11-06 cada receptor recibió entre 2,4 y 2,6 Mbps con 14 videos en la sala. Un Mbps durante una hora equivale a 0,419 GiB.

| Tráfico | Cálculo | GiB | USD |
|---|---|---|---|
| Junta del viernes, 50 receptores a 2,4 Mbps, por hora | 120 Mbps x 0,419 | 50,3 | 9,56 |
| Junta del viernes, 1 h a la semana, por mes | 50,3 x 4,33 | 218 | 41,40 |
| Prueba de carga del 2026-11-06, medida | | 34,3 | ≤ 6,52 |

El tráfico de lunes a jueves depende de cuántas personas hablen con cámara y durante cuánto tiempo. Los dos escenarios del resumen:

| Escenario | GiB al mes | USD al mes | Lectura |
|---|---|---|---|
| Uso medido (tráfico estimado) | 218 | 41,40 | La junta del viernes real; el uso diario medido apenas suma tráfico |
| Uso fuerte (poco probable) | ~447 | 85,00 | La junta del viernes más varias horas al día de llamadas en grupo con algunas cámaras. Es el costo máximo esperado |

Las grabaciones que se descargan de Cloud Storage también cuentan como egress, a razón de unos 1,2 GB por hora de grabación.

## Gather

La [página de precios de Gather](https://www.gather.town/pricing) muestra un único plan de autoservicio, **Essential**, a 12 USD por miembro al mes, o un 20 % menos con pago anual. Incluye reuniones y chat ilimitados, una oficina personalizada, grabaciones y transcripciones ("starting at 20 hours" y "30 hours", sin indicar la unidad), invitados e integración con calendario. SSO, oficinas personalizadas más grandes y precios regionales solo están en el plan **Custom**, por cotización. Hay una prueba de 30 días y ningún plan gratuito permanente.

| Miembros | Pago mensual | Pago anual |
|---|---|---|
| 50 | 600 | 480 |
| 60 | 720 | 576 |

Gather cobra por miembro aunque la persona no se conecte ese mes, y el tráfico está incluido.

## Labs frente a Gather

| | Labs en GCP | Gather Essential |
|---|---|---|
| Costo para 60 personas | 106,80-150,40 USD/mes | 576-720 USD/mes |
| Crece con | El tráfico (egress) | El número de miembros |
| Horario | Solo en horario de oficina; fuera de él la oficina no responde | Siempre disponible |
| Grabación | Sí, en un bucket propio, 30 días | Sí, con límite de horas |
| Transcripciones | No | Sí |
| Inicio de sesión | Email y contraseña con Identity Platform; sin SSO configurado | SSO solo en el plan Custom |
| Ubicación de los datos | Nuestro proyecto de GCP | Servidores de Gather |
| Quién lo mantiene | Nosotros | Gather |

## Cómo afinar la estimación

1. **Vuelva a medir el egress cuando la oficina tenga uso real**, con la misma métrica de Cloud Monitoring, para confirmar cuál de los dos escenarios corresponde.
2. **Cree una alerta de presupuesto** en Cloud Billing por unos 120 USD al mes (junta semanal real más margen), con avisos al 80 % y al 100 %.
3. **Confirme los precios no verificados** (IP con la VM detenida, Cloud SQL, Cloud Storage) en la calculadora de precios.
