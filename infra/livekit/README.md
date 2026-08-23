# Stack de audio/vídeo self-hosted — PoC Fase 0

Valida lo que el PRD marca como **riesgo #1 del proyecto** (§13): WebRTC self-hosted
con grabación propia. El cierre del PRD pide exactamente esto como siguiente paso.

## Estado: validado end-to-end ✅

Grabación real producida y verificada el 2026-08-23:

| Comprobación | Resultado |
|---|---|
| LiveKit server arranca | v1.13.5, Redis conectado, 0 errores |
| Egress se registra | `service ready`, `cpu available: 16 → max cost: 4` |
| Bucket de grabaciones | `recordings` creado en MinIO |
| Grabación → MinIO | `sala-prueba-*.mp4`, 6.4 MiB + manifiesto JSON |
| El MP4 decodifica | H.264 Main 1280×720 @30fps + AAC 44.1 kHz estéreo, 18.2 s, seekable |

Dato para el dimensionamiento que el PRD §13 pide vigilar: Egress reporta
`max cost: 4` sobre 16 CPUs, es decir ~**4 grabaciones concurrentes** en esta máquina.
Escala por CPU, no por usuarios conectados.

## Servicios

| Servicio | Rol |
|---|---|
| `livekit` | SFU: reparte los streams. No P2P — P2P no pasa de ~6 por sala (PRD 6.3) |
| `egress` | Compone la sala en un Chrome headless y graba a MP4 |
| `minio` | Almacenamiento S3-compatible propio para las grabaciones |
| `redis` | Canal de control entre `livekit` y `egress`. Egress no funciona sin él |

## Uso

```sh
cp .env.example .env        # y regenerar los secretos como indica el archivo
docker compose up -d
docker compose ps
```

| Endpoint | Para qué |
|---|---|
| `http://localhost:7880` | LiveKit: señalización HTTP/WebSocket |
| `http://localhost:9001` | consola web de MinIO (usuario/clave del `.env`) |

Prueba end-to-end de grabación:

```sh
./test-recording.sh                    # sala "sala-prueba", 20 s
DURACION=45 ./test-recording.sh demo   # sala "demo", 45 s
```

Publica vídeo de prueba, graba con Egress, y falla con exit ≠ 0 si el MP4 no
aterriza en MinIO o pesa 0 B.

Bajar todo (`-v` borra también las grabaciones):

```sh
docker compose down          # conserva el volumen de MinIO
docker compose down -v       # borra las grabaciones
```

## Gotchas que costaron tiempo

**1. El bloque `s3` del config de Egress NO es un destino por defecto.**
El más caro de los cinco. Con `s3` configurado en `EGRESS_CONFIG_BODY` pero sin
destino en el request, Egress no sube a S3: intenta una *escritura local* en la raíz
del filesystem y muere con `Local upload failed: open /<archivo>.mp4: permission
denied`. El destino va **en el request, dentro de cada `file_output`**. El síntoma
engaña: la grabación funciona, el MP4 existe en `/home/egress/tmp/<egressID>/`, y
el bucket queda vacío sin ningún error visible hasta que el egress termina.

**2. `lk egress stop` exige `--id`; posicional falla en silencio.**
`lk egress stop EG_xxx` sale con código 1 y un texto de ayuda. Si el script silencia
ese error, la grabación queda corriendo indefinidamente sin subir nada.

**3. Rango UDP pequeño a propósito.**
`livekit.yaml` publica 50000-50019, no el 50000-60000 habitual: publicar 10.000
puertos UDP en Docker hace que el arranque tarde minutos. 20 sobran para una PoC.
Ampliar en producción.

**4. El manifiesto reporta `https://` aunque el endpoint sea `http://`.**
El JSON que Egress sube junto al vídeo trae
`"location": "https://minio:9000/recordings/..."`. La app no debe confiar en ese
esquema para construir URLs de reproducción; hay que derivarlas de la configuración
propia (relevante para PRD 4.9 en Fase 1).

**5. Egress necesita `SYS_ADMIN` y `/dev/shm` grande.**
Corre un Chrome headless dentro. Sin `cap_add: SYS_ADMIN` el sandbox no arranca y
sin `shm_size` suficiente el navegador muere al renderizar. La imagen pesa 4.76 GB
justamente por eso.

## Decisión: coturn queda para producción

El PRD §6.5 pide coturn propio para atravesar NATs corporativos. Aquí el TURN
embebido de LiveKit está **apagado** y coturn **no** se despliega, a propósito: sin
IP pública ni certificados TLS, un TURN local no atraviesa nada y solo mete ruido en
los logs. La travesía de NAT no se puede validar en localhost — es trabajo de Fase 1
con infraestructura real.

Cuando llegue ese momento hay una decisión pendiente: LiveKit trae TURN embebido
(camino documentado por el proveedor, un servicio menos que mantener) frente a coturn
separado como dice el PRD. No la resolvimos porque no toca todavía.

## Lo que esta PoC NO demuestra

- **Travesía de NAT/firewall corporativo** — necesita IP pública y TLS.
- **Escala.** Se validó con un publicador. El PRD apunta a 500 concurrentes; el SFU
  necesita CPU dedicada por participante activo y Egress transcodifica en tiempo real.
- **Política de retención.** El PRD §13 avisa que el vídeo diario acumula varios
  GB/semana. Aquí no hay ninguna regla de borrado.
