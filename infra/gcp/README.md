# Despliegue en GCP - entorno `test`

Infraestructura del entorno desplegado de la oficina virtual (issue #3). Una sola
VM de Compute Engine corre los cinco contenedores; Terraform crea todo lo demás.

**Solo existe el entorno `test`.** Producción espera a que aterrice el login con
Google (issue #8): hasta entonces no hay nada que proteger detrás de una
autenticación real y mantener dos entornos sería pagar el doble por lo mismo.
Todo está parametrizado por `var.env` para que el segundo entorno sea un
`terraform.tfvars` distinto, no una copia del módulo.

## Qué hay aquí

| Ruta | Qué es |
|---|---|
| `terraform/` | Estado de la infraestructura: VM, red, IAM, registro de imágenes, secretos, federación con GitHub |
| `docker-compose.yml` | Los cinco servicios de la VM. Vive en `/opt/office/` |
| `Caddyfile` | Terminación TLS y enrutado de los dos hostnames |
| `livekit.yaml.tpl` | Configuración del SFU. Plantilla: el hostname se sustituye al desplegar |
| `startup-script.sh` | Arranque de la VM: instala Docker y los scripts de operación |
| `scripts/office-deploy.sh` | Despliegue idempotente. Se instala como `/usr/local/bin/office-deploy` |
| `scripts/office-cert-watch.sh` | Reinicia LiveKit cuando Caddy renueva su certificado |
| `docker/colyseus.Dockerfile` | Imagen del servidor de Node |
| `docker/web.Dockerfile` | Imagen del SPA construido |
| `docker/web-nginx.conf` | Configuración de la capa estática del SPA |

El workflow de despliegue es `.github/workflows/deploy-test.yml`, separado de
`ci.yml`. El `.dockerignore` de la raíz acota el contexto de build de las dos
imágenes.

## Por qué una sola VM

LiveKit necesita UDP para la media WebRTC y para el TURN embebido. Cloud Run solo
habla HTTP/1.x y HTTP/2 sobre TLS, así que el SFU obliga a una VM de todas formas.
Una vez pagada esa VM, partir Colyseus y el SPA hacia Cloud Run habría significado
dos superficies de despliegue y dos formas de leer logs para salvar un proceso de
Node que cabe de sobra en la misma máquina.

**Sin Redis**, a diferencia de `infra/livekit/docker-compose.yml`. LiveKit solo lo
necesita para coordinar varios nodos entre sí y para hablar con Egress; aquí hay un
único nodo y la grabación está aplazada al issue #5. Vuelve a hacer falta el día que
se despliegue Egress o un segundo SFU.

**Con Postgres, y también dentro de la misma VM** (issue #24). El directorio de
usuarios e invitaciones necesita una base de datos, y la instancia más barata de
Cloud SQL cuesta más que la VM entera, además de traer red privada, IAM y más
Terraform para guardar unos centenares de filas. Corre como un contenedor más,
sobre un volumen con nombre. El precio de esa decisión es real y está aceptado:
**las copias de seguridad son manuales y la durabilidad del dato es la del disco
de la VM.** Está desarrollado más abajo, en *Copias de seguridad*.

## Hostnames sin dominio propio

Todavía no hay dominio. Se usa [sslip.io](https://sslip.io), que resuelve
`<lo-que-sea>.<ip-con-guiones>.sslip.io` a esa misma IP. Dos hostnames sobre la
misma IP estática, separados por SNI:

| Hostname | Qué sirve |
|---|---|
| `app.<ip>.sslip.io` | El SPA, el WebSocket de Colyseus, `/livekit/token`, `/health` y `/admin/*` |
| `lk.<ip>.sslip.io` | Señalización de LiveKit y su TURN |

La IP reservada **no es opcional**: el hostname se deriva de ella, así que una IP
efímera cambiaría la URL en cada reinicio y dejaría inválido el certificado.

## Orden de arranque (una sola vez, a mano)

### 1. Bucket del estado de Terraform

El bucket no puede crearse desde el propio estado que lo usa: el backend se
resuelve antes que cualquier recurso. Es la única pieza que se crea a mano.

```sh
gcloud storage buckets create gs://labs-office-tfstate \
  --project=vaulted-channel-505114-f0 \
  --location=us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update gs://labs-office-tfstate --versioning
gcloud storage buckets update gs://labs-office-tfstate \
  --update-labels=app=labs-office,env=test
```

El versionado protege de un `terraform apply` que corrompa el estado. Las
etiquetas son las mismas que lleva todo lo demás, para que el gasto se agrupe.

Después, descomentar el bloque `backend "gcs"` de `terraform/versions.tf`.

### 2. Primer `apply`

```sh
cd infra/gcp/terraform
cp terraform.tfvars.example terraform.tfvars   # y rellenar acme_email
terraform init
terraform plan
terraform apply
```

En este punto la VM ya existe y arranca, pero **todavía no levanta contenedores**:
no hay imágenes publicadas ni valores de secreto. El script de arranque instala
Docker, escribe la configuración en `/opt/office/` y se detiene al no encontrar
ninguna versión de los secretos. En `journalctl -u google-startup-scripts` aparece
ese error; es lo esperado hasta el paso 3.

### 3. Cargar los valores de los secretos

Terraform crea los *contenedores* de secreto, nunca su contenido: meter el valor en
Terraform lo dejaría en el fichero de estado en texto plano, que es justo el
problema que Secret Manager resuelve. Las versiones se añaden aquí y Terraform no
las gestiona ni las borra.

```sh
# La clave puede ser cualquier identificador estable; el secreto, aleatorio.
printf 'labs-office' | \
  gcloud secrets versions add labs-office-test-livekit-api-key --data-file=-

openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets versions add labs-office-test-livekit-api-secret --data-file=-

# Contraseña del Postgres del directorio (issue #24).
openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets versions add labs-office-test-db-password --data-file=-
```

Sin este tercer valor el despliegue **no arranca**: `office-deploy` aborta antes de
escribir el `.env`, igual que con los dos de LiveKit, para no dejar nunca una
credencial vacía en el fichero.

Hexadecimal no es casualidad: esa contraseña acaba dentro de una URL
(`DATABASE_URL`), y aunque el script la escapa antes de componerla, un valor sin
caracteres raros se lee mejor en cualquier diagnóstico.

Y un aviso que solo aplica a este secreto: **Postgres lee la contraseña una única
vez, cuando inicializa el volumen**. Añadir una versión nueva al secreto más
adelante cambia lo que el servidor intenta usar, pero no lo que la base espera, y
el resultado es un servidor que ya no conecta. Rotarla de verdad es entrar por SSH
y hacer `ALTER USER office WITH PASSWORD ...` dentro del contenedor antes de
redesplegar.

Los dos valores van **sin salto de línea final**, y por eso están el `printf` (que no
lo añade, al contrario que `echo`) y el `tr -d '\n'` (porque `openssl rand` sí lo
añade). No es cosmético y falla de dos formas distintas: LiveKit compone
`clave: secreto` a partir de estos dos valores y un `\n` de más rompe ese formato,
y el servidor firma los tokens con el secreto tal cual lo recibe, así que un byte
de diferencia produce una firma que el SFU rechaza. El síntoma sería audio que no
conecta nunca, sin ningún error que apunte aquí.

Para comprobarlo, cuenta bytes en vez de mirar el valor:

```sh
gcloud secrets versions access latest \
  --secret=labs-office-test-livekit-api-secret | wc -c   # 64, no 65
```

### 4. Variables del repositorio en GitHub

El workflow no descubre nada por su cuenta: todo lo que necesita sale de
`terraform output` y se copia una vez. Ninguna de estas es secreta (son
identificadores públicos), así que van como *variables* de repositorio, no como
*secrets*.

```sh
terraform output
```

| Variable de repositorio | De dónde sale |
|---|---|
| `GCP_PROJECT_ID` | el proyecto, `vaulted-channel-505114-f0` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | output `workload_identity_provider` |
| `GCP_DEPLOYER_SA` | output `deployer_service_account` |
| `APP_HOST` | output `app_host` |
| `FIREBASE_API_KEY` | opcional; sin ella el SPA se construye sin pantalla de login (issue #8, ver más abajo) |
| `FIREBASE_PROJECT_ID` | opcional, solo si Identity Platform vive en otro proyecto que `GCP_PROJECT_ID` |
| `FIREBASE_AUTH_DOMAIN` | opcional, por defecto `<projectId>.firebaseapp.com` |
| `GCP_ZONE` | opcional, por defecto `us-central1-a` |
| `GCP_REGION` | opcional, por defecto `us-central1` |
| `GCP_INSTANCE` | opcional, por defecto `labs-office-test` |
| `GCP_AR_REPOSITORY` | opcional, por defecto `labs-office-test`; output `artifact_registry` sin el prefijo del registro |

`APP_HOST` se fija a mano a propósito: el SPA lo hornea en el bundle
(`VITE_COLYSEUS_URL`) y el workflow no tiene permiso para leer la IP estática. Si
alguna vez cambia la IP, hay que actualizar esta variable.

### 5. Primer despliegue

```sh
git push origin main          # o lanzar "Deploy (test)" a mano desde Actions
```

El workflow construye las dos imágenes, las publica etiquetadas con el SHA del
commit, entra por el túnel IAP y ejecuta `office-deploy <sha>`. Ese script relee la
configuración de la metadata, vuelve a leer los secretos, reescribe
`/opt/office/.env` con permisos `0600` de root y levanta el compose.

El último paso golpea `https://<APP_HOST>/health` hasta 20 veces: en el primer
despliegue Caddy todavía está negociando el certificado y eso tarda decenas de
segundos. Si nunca devuelve 200, el job falla.

## Cómo se despliega a partir de ahí

Cada push a `main` dispara el workflow. No hay nada que editar a mano en la VM: el
tag de imagen viaja como argumento hasta `office-deploy` y de ahí al `.env` que lee
el compose, así que lo que corre en la máquina siempre es reconstruible desde este
repositorio.

Las imágenes se etiquetan con el SHA del commit, **nunca** con `latest`. Con
`latest` no se puede saber qué corre en la VM ni volver atrás sin reconstruir.
Volver a una versión anterior es entrar y pasarle el SHA viejo:

```sh
gcloud compute ssh labs-office-test --zone us-central1-a --tunnel-through-iap \
  --command "sudo /usr/local/bin/office-deploy <sha-anterior>"
```

### Diagnóstico

```sh
gcloud compute ssh labs-office-test --zone us-central1-a --tunnel-through-iap

sudo docker compose --project-directory /opt/office ps
sudo docker compose --project-directory /opt/office logs --tail 100 caddy
sudo journalctl -u google-startup-scripts     # problemas de arranque de la VM
```

## Secretos: de dónde salen y dónde no están

`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, la contraseña de Postgres y la clave de la
cuenta de servicio de Identity Platform viven **solo** en Secret Manager. No están
en el repositorio, ni en un `.env` commiteado, ni en los secretos de GitHub, ni en
el estado de Terraform.

Las dos primeras y la contraseña de la base son obligatorias: si Secret Manager
devuelve un valor vacío, `office-deploy` aborta antes de escribir nada. La clave de
Identity Platform **no** entra en ese guardia, y es deliberado: puede faltar
legítimamente, porque la cuenta de servicio es opcional y mientras no exista lo
único que se degrada es el endpoint que crea cuentas. Tumbar toda la oficina por una
función que nadie ha pedido todavía sería el fallo, no la protección.

La VM los lee en cada despliegue con el token de su propia cuenta de servicio
(API REST de Secret Manager, sin instalar el SDK de gcloud) y los escribe en
`/opt/office/.env` con permisos `0600` de root. Ese fichero se escribe a un
temporal y se mueve: si la lectura falla a mitad, el `.env` anterior sigue intacto
y el stack sigue en pie. Los scripts nunca imprimen los valores y nunca activan
`set -x`.

Los permisos están concedidos **secreto a secreto**, no a nivel de proyecto. Esto
importa porque el proyecto GCP es compartido: aloja una VM ajena (`engram-cloud`),
un bucket y otros secretos que no pertenecen a este repo.
`roles/secretmanager.secretAccessor` sobre el proyecto le daría a nuestra VM
lectura sobre todos ellos. Por la misma razón todas las reglas de firewall llevan
`target_tags = ["labs-office"]`, copiando la convención que ya usa
`engram-allow-web` con su propia etiqueta.

## Puertos abiertos

Todos acotados a la etiqueta de red `labs-office`, nunca a toda la red.

| Puerto | Para qué |
|---|---|
| `tcp:80` | Desafío HTTP-01 de ACME. No se puede cerrar aunque el tráfico útil vaya por 443 |
| `tcp:443` | HTTPS y WSS |
| `tcp:7881` | Fallback de ICE sobre TCP cuando la red del cliente bloquea UDP |
| `udp:3478` | TURN embebido sobre UDP |
| `tcp:5349` | TURN embebido sobre TLS |
| `udp:50000-60000` | Media WebRTC |
| `tcp:22` | **Solo** desde `35.235.240.0/20`, el rango del túnel IAP |

El proyecto tiene además una regla preexistente `default-allow-ssh` que abre el 22
desde `0.0.0.0/0` sin etiquetas. No se toca: afecta también a la VM ajena. El
diseño de aquí simplemente no depende de ella.

## Autenticación con usuario y contraseña (issue #8)

Hasta este cambio no había autenticación: cualquiera que alcanzara la web entraba a
la oficina. Ahora el acceso lo decide **GCP Identity Platform** (el mismo motor que
Firebase Authentication), con cuentas de correo y contraseña.

El reparto de responsabilidades es el que importa entender:

- **Identity Platform** guarda las cuentas, comprueba la contraseña y firma un ID
  token (un JWT RS256 de una hora). Nosotros nunca vemos ni almacenamos contraseñas.
- **El SPA** (`src/auth/`) enseña la pantalla de login, pide ese token y lo adjunta
  al entrar a la sala y al pedir el token de LiveKit.
- **El servidor** (`server/src/verifyIdToken.ts`) verifica la firma contra las claves
  públicas de Google y comprueba emisor, audiencia y caducidad. Sin token válido no
  hay sala ni audio. La pantalla sola no protegería nada: el WebSocket se puede abrir
  sin pasar por ella.

Los dos lados se activan por configuración y **por separado**, y ninguno de los dos
está activo por defecto:

| Dónde | Variable | Vacía | Con valor |
|---|---|---|---|
| Servidor | `FIREBASE_PROJECT_ID` | sin autenticación, como antes | falla cerrado |
| SPA (build) | `VITE_FIREBASE_API_KEY` + `VITE_FIREBASE_PROJECT_ID` | sin pantalla de login | pide login |

Tenerlos descuadrados da los dos síntomas obvios: solo el servidor, y nadie entra;
solo el SPA, y el login es decorativo. `GET https://<APP_HOST>/health` devuelve
`auth: "enabled" | "disabled"` para saber en cuál de los dos modos corre el servidor.

### Puesta en marcha, una sola vez

```sh
PROJECT_ID=vaulted-channel-505114-f0

gcloud services enable identitytoolkit.googleapis.com --project "${PROJECT_ID}"
```

Después, en la consola de GCP, **Identity Platform → Providers → Add a provider →
Email/Password**, con "Allow password sign-up" *desactivado*: la oficina es de una
sola organización y las cuentas las crea un administrador, no cualquiera que
encuentre la URL. La sección 10 del PRD las trata como invitaciones, no como
registro abierto.

La API key del cliente sale de **APIs & Services → Credentials**. No es un secreto:
Firebase la publica en el bundle por diseño y no autoriza nada por sí sola. Quien
decide el acceso son las cuentas y la verificación del token en el servidor.

Crear la primera cuenta (con el sign-up aún permitido, o desde la consola en
**Users → Add user**):

```sh
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alguien@ejemplo.com","password":"...","returnSecureToken":true}'
```

### Activarlo en el entorno desplegado

1. Variables de repositorio en GitHub: `FIREBASE_API_KEY` y, si el proyecto de
   Identity Platform no es el mismo que `GCP_PROJECT_ID`, también
   `FIREBASE_PROJECT_ID`. Mientras no existan, el despliegue sigue funcionando y
   publica el SPA sin pantalla de login, avisando en el log del workflow.
2. `auth_project_id` en `terraform/terraform.tfvars` y `terraform apply`. Eso escribe
   la metadata `office-auth-project-id` de la VM.
3. Volver a desplegar. `office-deploy` la copia a `FIREBASE_PROJECT_ID` en
   `/opt/office/.env` y el servidor arranca ya exigiendo token.

El orden importa: si se activa el servidor antes de que existan cuentas, nadie puede
entrar. Por eso `auth_project_id` está vacío por defecto y activarlo es un gesto
deliberado, no el efecto colateral de un redespliegue.

### Alta de cuentas: siempre a mano

No hay registro en la aplicación, ni lo va a haber por ahora: **las cuentas las crea
un administrador** desde la consola de GCP, una por persona invitada. Es una decisión,
no una carencia, y es lo que cierra el issue #8.

Con "Allow password sign-up" desactivado en el proveedor, nadie puede darse de alta
por su cuenta aunque conozca la URL: el único camino hacia una cuenta pasa por alguien
que ya está dentro. Una lista de invitados en configuración no añadiría nada sobre
esto, solo un sitio más donde equivocarse.

El día que haga falta autoservicio (que alguien invitado ponga su propia contraseña),
el mecanismo de GCP es una *blocking function* `beforeUserCreated` que rechace los
correos fuera de la lista. Entonces sí hará falta, porque el alta dejaría de pasar por
un humano, y también si algún día se enciende el acceso con Google, que crea la cuenta
sola en el primer inicio de sesión.

### Lo que este cambio NO resuelve

- **Roles** (Admin/Empleado/Invitado): hace falta el backend del issue #7. Hoy toda
  cuenta válida entra con los mismos permisos. El issue #24 trae el directorio que
  los guarda y el panel que los reparte; ver más abajo.
- **CORS**: sigue en `*`. Es el issue #9, y ahora que la ruta del token está atada a
  la sesión autenticada su riesgo es mucho menor, pero no desaparece.

Fuera de alcance por decisión, no por pendiente:

- **Entrar con Google.** Correo y contraseña cubren el acceso a la oficina, así que el
  segundo proveedor no aporta nada hoy. Ojo con un detalle del PRD: la sección 4.10
  ata Google OAuth a la integración con Google Calendar (issue #14), porque leer el
  calendario de alguien exige su consentimiento OAuth. Ese issue tendrá que traerse su
  propio acceso con Google; no lo hereda de aquí.

## Directorio, panel de administración e invitaciones (issue #24)

El issue #8 dejó la puerta cerrada, pero dentro todo el mundo entraba igual: no
había ni roles ni forma de invitar a nadie sin abrir la consola de GCP. Esto añade
un directorio propio (usuarios, roles e invitaciones) y un panel para
administrarlo.

### El contenedor y el volumen

| Pieza | Qué es |
|---|---|
| Contenedor `postgres` | `postgres:17-alpine`, fijado por tag **y** digest como `caddy` y `livekit`. No publica ningún puerto: el único que le habla es `colyseus`, por la red interna del compose |
| Volumen `office-db` | `/var/lib/postgresql/data`. Aquí viven los usuarios, sus roles y las invitaciones |

`caddy-data` y `office-db` no se parecen en nada aunque los dos sean volúmenes con
nombre: un certificado perdido se vuelve a emitir solo, y esto **no se reemite
desde ningún sitio**.

`colyseus` espera a que Postgres esté *sano*, no solo arrancado:

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

El `depends_on` en forma de lista que usa `caddy` no serviría aquí. Solo espera a
que el contenedor exista, y Postgres arranca su contenedor en milisegundos pero
tarda bastante más en aceptar conexiones. Como el servidor corre las migraciones
nada más arrancar, sin la condición el primer despliegue muere con un
`ECONNREFUSED` que `restart: unless-stopped` acaba tapando tras unos reinicios: un
arranque que funciona por casualidad y unos logs que no explican por qué.

### Variables que añade

| Variable | Vacía | Con valor | ¿Secreto? |
|---|---|---|---|
| `DATABASE_URL` | sin directorio; el servidor se comporta igual que antes | migra el esquema al arrancar y sirve el panel | la compone `office-deploy` con la contraseña de Secret Manager |
| `BOOTSTRAP_SUPERADMIN_EMAIL` | nadie puede hacer el arranque en frío | ese correo se promociona a superadmin | **no**: es una dirección de correo |
| `IDENTITY_ADMIN_CREDENTIALS` | invitar cuentas devuelve 503; el resto del panel funciona | el servidor puede dar de alta cuentas en Identity Platform | **sí** |

La degradación es la misma convención que `FIREBASE_PROJECT_ID`: sin configuración,
el comportamiento anterior; con ella, la función nueva. `GET /health` dice en qué
modo corre.

`BOOTSTRAP_SUPERADMIN_EMAIL` no pasa por Secret Manager por el mismo motivo que
`FIREBASE_PROJECT_ID`: conocerlo no da acceso a nada. Lo que protege la oficina es
la verificación de la firma del ID token, no que ese valor sea desconocido.

### El arranque en frío del superadmin

La regla, exacta:

> El **primer** inicio de sesión cuyo correo verificado coincida con
> `BOOTSTRAP_SUPERADMIN_EMAIL` promociona esa cuenta a superadmin, y **solo
> mientras el directorio no tenga ya un superadmin**.

En cuanto existe uno, la regla deja de aplicarse: cambiar el valor de la variable
más adelante no promociona a nadie. A partir de ahí los roles se reparten desde el
panel.

**Y aquí está la trampa.** El issue #8 desactivó "Allow password sign-up" en el
proveedor de Identity Platform: nadie puede darse de alta por su cuenta. Así que la
cuenta de `BOOTSTRAP_SUPERADMIN_EMAIL` **tiene que existir antes**, creada a mano
en la consola (**Identity Platform → Users → Add user**). Si no existe, ese correo
no puede iniciar sesión, nadie se promociona nunca y el directorio se queda sin
quien pueda administrarlo ni invitar a nadie. No hay una segunda puerta.

Para este despliegue el valor es `gthugo@outlook.com`. Se pone en
`terraform/terraform.tfvars` y viaja a la VM por metadata:

```hcl
bootstrap_superadmin_email = "gthugo@outlook.com"
```

Orden correcto: crear la cuenta en la consola → `terraform apply` → redesplegar →
iniciar sesión con ella.

### El panel vive en `/dashboard`, sin enlace

Se llega **solo escribiendo la URL**: `https://<APP_HOST>/dashboard`. No hay ningún
enlace hacia él en la interfaz, a propósito, mientras el panel madura.

El enlace profundo ya funciona sin tocar nada más, y son dos piezas las que lo
consiguen: el `handle` sin ruta del `Caddyfile` manda todo lo que no es una ruta
del servidor al contenedor `web`, y el `try_files $uri $uri/ /index.html` de
`docker/web-nginx.conf` devuelve el índice para cualquier ruta que no sea un
fichero. El SPA resuelve `/dashboard` en el cliente.

Lo que **no** funciona solo es el sentido contrario, y es el punto 3 del issue #24:
una ruta nueva del servidor sin su propio `handle` en el `Caddyfile` no da 404, cae
en ese mismo `handle` final y devuelve `index.html` con un 200. El síntoma es un
`Unexpected token '<'` en el navegador y ni una línea en los logs del servidor,
porque la petición nunca llegó hasta él. Por eso la API del panel tiene su bloque:

```caddy
handle /admin/* {
	reverse_proxy colyseus:2567
}
```

El comodín cubre las rutas de `/admin/` que vengan después. El `handle` sin ruta
tiene que seguir siendo **el último** del sitio.

### Copias de seguridad

**No hay ninguna copia automática. Ninguna.** No hay snapshot programado del disco,
ni `pg_dump` en un temporizador, ni exportación a un bucket. Destruir la VM, o
borrar el volumen `office-db`, **destruye el directorio entero**: todos los
usuarios, todos los roles y todas las invitaciones. No se recupera de ningún sitio.

Es el precio aceptado de correr Postgres en la misma VM en vez de en Cloud SQL, y
está escrito aquí para que sea una decisión y no una sorpresa.

La copia se hace a mano, y esto es lo que hay que ejecutar:

```sh
gcloud compute ssh labs-office-test --zone us-central1-a --tunnel-through-iap \
  --command "sudo docker compose --project-directory /opt/office exec -T postgres \
    pg_dump -U office -d office --clean --if-exists" \
  > "office-db-$(date +%Y%m%d-%H%M).sql"
```

Restaurar es el mismo camino al revés:

```sh
gcloud compute ssh labs-office-test --zone us-central1-a --tunnel-through-iap \
  --command "sudo docker compose --project-directory /opt/office exec -T postgres \
    psql -U office -d office" \
  < office-db-20260101-1200.sql
```

El `-T` no es opcional: sin él Docker intenta reservar un TTY y el volcado sale
corrupto. El fichero resultante lleva el directorio completo en texto plano
(correos y roles, nunca contraseñas: esas viven en Identity Platform), así que no
va al repositorio ni a un sitio compartido.

Conviene correrlo antes de cualquier `terraform apply` que pueda recrear la VM.

### Lo que falta para que las invitaciones funcionen de verdad

El panel y el directorio funcionan sin nada más. Lo que no funciona es **crear la
cuenta** de la persona invitada: ese endpoint devuelve 503 hasta que exista una
cuenta de servicio de Identity Platform y su clave esté cargada en Secret Manager.
Es una degradación querida, no un fallo: la función es opcional y no debe tumbar el
despliegue.

Los tres pasos, en orden:

1. **Crear la cuenta de servicio** y darle el rol mínimo que permite crear y
   modificar cuentas: **Firebase Authentication Admin**
   (`roles/firebaseauth.admin`); en proyectos gestionados como Identity Platform el
   equivalente es `roles/identityplatform.admin`. Comprobar el nombre exacto en el
   selector de la consola antes de conceder. Lo que **no** se concede es
   `roles/editor` ni nada a nivel de proyecto: el proyecto GCP es compartido y aloja
   recursos ajenos.

   ```sh
   PROJECT_ID=vaulted-channel-505114-f0

   gcloud iam service-accounts create labs-office-identity-admin \
     --display-name "Alta de cuentas desde el panel de la oficina" \
     --project "${PROJECT_ID}"

   gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
     --member "serviceAccount:labs-office-identity-admin@${PROJECT_ID}.iam.gserviceaccount.com" \
     --role roles/firebaseauth.admin
   ```

2. **Crear el contenedor del secreto** poniendo `enable_identity_admin_secret = true`
   en `terraform.tfvars` y aplicando. Está desactivado por defecto porque dejar un
   secreto vacío y permanente en un proyecto compartido es peor que no tenerlo.

3. **Cargar la clave** como valor del secreto:

   ```sh
   gcloud iam service-accounts keys create /tmp/identity-admin.json \
     --iam-account "labs-office-identity-admin@${PROJECT_ID}.iam.gserviceaccount.com"

   gcloud secrets versions add labs-office-test-identity-admin \
     --data-file=/tmp/identity-admin.json

   shred -u /tmp/identity-admin.json
   ```

   `office-deploy` compacta ese JSON a una sola línea antes de escribirlo en el
   `.env`: un valor multilínea rompería el fichero y el compose leería solo la
   primera línea. Sigue siendo el mismo JSON.

   La clave sí es de las que no caducan, que es justo lo que se evitó para el CI con
   la federación de GitHub. Aquí no hay alternativa equivalente: el servidor corre
   dentro de la VM y necesita credenciales de una identidad distinta a la suya.
   Rotarla es repetir este paso y borrar la versión vieja de la cuenta de servicio.

Después, redesplegar.

## Caveats conocidos

### sslip.io comparte el límite de emisión de Let's Encrypt

`sslip.io` es un dominio registrado compartido por todo el mundo que lo use, y
Let's Encrypt aplica sus límites de emisión por dominio registrado. Si alguien
ajeno quema la cuota, nuestras emisiones fallan.

La exposición real es pequeña: dos certificados que se renuevan cada ~60 días. Y
Caddy cae solo a ZeroSSL cuando Let's Encrypt rechaza, sin configuración extra. Por
eso no se monta nada para evitarlo. Desaparece con un dominio propio.

Efecto secundario si esa caída a ZeroSSL ocurre: la ruta donde Caddy guarda el
certificado contiene el nombre del directorio de la autoridad emisora, y
`livekit.yaml.tpl` la tiene fija apuntando a Let's Encrypt. El TURN sobre TLS
dejaría de encontrar su certificado hasta actualizar esas dos líneas; el TURN sobre
UDP seguiría funcionando.

### El TURN no cubre redes que solo dejan salir por el 443

El TURN embebido escucha en `udp:3478` y `tcp:5349`. Una red corporativa que solo
permita salida por el 443 no llega a ninguno de los dos.

Multiplexar TURN/TLS sobre el mismo 443 exigiría compilar Caddy con el módulo
`layer4`, porque Caddy ocupa ese puerto para HTTPS. Se aplaza a un issue hijo. En
esas redes el audio no conecta; el resto de la aplicación sí.

### TURN embebido en lugar de coturn

El PRD §6.5 pedía coturn propio e `infra/livekit/README.md` dejó la decisión
abierta a propósito. Se resuelve aquí a favor del TURN embebido de LiveKit: es el
camino que documenta el propio proveedor, comparte claves y ciclo de vida con el
SFU, y evita mantener un servicio más con su propia configuración y sus propios
certificados.

## Cuando llegue el dominio propio

Ya no lo trae el issue #8: el login con correo y contraseña funciona sobre `sslip.io`
tal cual, porque no usa redirecciones. Quien lo necesitará es la integración con Google
Calendar (issue #14), que sí exige orígenes de redirección estables para su OAuth.
Cuando toque, lo que hay que tocar:

1. Apuntar dos registros `A` (`app.` y `lk.`, o los nombres que se elijan) a la IP
   estática, que no cambia.
2. Cambiar `local.app_host` y `local.lk_host` en `terraform/main.tf` por los
   nuevos nombres. Todo lo demás los consume desde ahí: el Caddyfile por variable
   de entorno, `livekit.yaml` por sustitución en la plantilla, y el SPA por el
   `build-arg` que el workflow deriva de `APP_HOST`.
3. Actualizar la variable de repositorio `APP_HOST` y volver a desplegar, para que
   el bundle se reconstruya con el `VITE_COLYSEUS_URL` nuevo.
4. Estrechar el `Access-Control-Allow-Origin: *` de
   `server/src/createOfficeServer.ts` al origen real (ya anotado en `TODOS.md`).

No hace falta recrear la VM ni la IP en ninguno de los cuatro pasos.
