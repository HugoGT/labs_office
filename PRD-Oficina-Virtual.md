# PRD — Oficina Virtual (Estilo Gather)
### Documento de Requerimientos del Producto

**Versión:** 1.1
**Fecha:** Julio 2026
**Escala objetivo:** Una sola empresa (50–500 usuarios), single-tenant
**Estilo visual:** Pixel art 2D, mapa top-down con avatares
**Modelo de negocio:** Uso interno, gratuito (sin monetización por ahora)
**Infraestructura de vídeo:** Self-hosted (requisito: grabación de reuniones dentro de la app)

---

## 1. Resumen ejecutivo

Se busca construir una **oficina virtual web** que simule un espacio de trabajo físico mediante un mapa 2D en pixel art donde los usuarios controlan un avatar. La comunicación de voz/vídeo se activa **por proximidad espacial** (como en Gather): solo escuchas a quien está cerca de ti o comparte tu "espacio delimitado". La aplicación debe funcionar como **PWA (Progressive Web App)**, instalable en Windows, macOS y Linux como si fuera una app nativa de escritorio.

Este proyecto se plantea como una **solución interna para una sola empresa** (no multi-tenant, no se vende a terceros por ahora), de **uso gratuito**, con **infraestructura de vídeo self-hosted** — decisión clave porque se requiere **grabar reuniones dentro de la propia app** (no es viable con SaaS gestionados que cobran/restringen la grabación o no dan acceso a los archivos crudos).

**Diferenciadores clave frente a una videollamada tradicional:**
- Sensación de "estar en la oficina" gracias al movimiento espacial.
- Conversaciones orgánicas por proximidad, sin salas de Zoom rígidas.
- Personalización del espacio de trabajo (decoración tipo "mi escritorio").
- Roles diferenciados con permisos claros (Admin / Empleado / Invitado).

---

## 2. Objetivos del producto

| Objetivo | Descripción |
|---|---|
| O1 | Replicar la sensación de coexistencia espacial de una oficina física |
| O2 | Permitir administración granular de espacios y accesos por roles |
| O3 | Soportar 50–500 usuarios concurrentes por instancia de oficina sin degradación notable |
| O4 | Ser instalable como app de escritorio (PWA) en Win/Mac/Linux |
| O5 | Permitir personalización visual (avatares y espacios) sin fricción |
| O6 | Grabar reuniones dentro de la propia infraestructura (self-hosted) |
| O7 | Integrar con Google Calendar para reservar/agendar espacios |

**Fuera de alcance (v1):** aplicaciones móviles nativas, integración con Slack/Notion/Jira, monetización o planes de pago, soporte multi-tenant (varias empresas clientes), pizarras colaborativas avanzadas (se puede dejar como v2/v3).

---

## 3. Roles y permisos

| Capacidad | Administrador | Empleado | Invitado |
|---|:---:|:---:|:---:|
| Invitar nuevos miembros (empleados) | ✅ | ❌ | ❌ |
| Invitar invitados externos | ✅ | ✅ (configurable) | ❌ |
| Crear/editar/eliminar espacios del mapa | ✅ | ❌ | ❌ |
| Decorar su propio escritorio/espacio | ✅ | ✅ | ❌ |
| Decorar espacios comunes | ✅ | ❌ | ❌ |
| Ver analíticas de uso de la oficina | ✅ | ❌ | ❌ |
| Moverse libremente por la oficina | ✅ | ✅ | ❌ (limitado a "sala de invitados") |
| Iniciar llamada haciendo clic en un avatar | ✅ | ✅ | ✅ (solo con quien lo invitó/su equipo) |
| Configurar permisos de sala (quién entra, cap. máx.) | ✅ | ❌ | ❌ |
| Expulsar/mutear usuarios | ✅ | ❌ (solo en su espacio propio, opcional) | ❌ |

**Nota de diseño:** conviene modelar esto como un sistema de permisos granular (no solo 3 roles fijos) para poder escalar a "Admin de espacio", "Manager de equipo", etc. en el futuro, pero para el MVP basta con estos 3 roles.

---

## 4. Requerimientos funcionales

### 4.1 Mapa y navegación
- Mapa 2D top-down en pixel art, dividido en **zonas/tiles**.
- El usuario mueve su avatar con flechas/WASD (desktop) o joystick táctil (si se abre en móvil vía navegador).
- Colisiones básicas (paredes, muebles) usando un tilemap.
- Minimapa opcional para oficinas grandes.
- **Editor de mapas híbrido:** se parte de un **mapa base prediseñado** (plantilla ya construida, con la estructura general de la oficina: paredes, pasillos, zonas) y el Admin puede **modificarlo agregando/moviendo assets por encima** (muebles, decoración, señalética) mediante drag & drop. No es necesario un editor 100% libre de tiles desde cero para el MVP — reduce complejidad de desarrollo sin perder flexibilidad real de personalización.

### 4.2 Audio/vídeo por proximidad
- **Espacios abiertos (proximidad):** el volumen de otros avatares disminuye con la distancia (falloff) y se corta fuera de un radio definido.
- **Espacios delimitados (rooms privados):** al entrar todos los que están dentro se escuchan entre sí a volumen completo, sin importar distancia dentro del espacio; quienes están fuera no escuchan nada de adentro (aislamiento acústico).
- **Espacios comunes:** capacidad ampliada (ej. cafetería, sala de juntas grande), múltiples personas pueden conversar simultáneamente, posiblemente con sub-agrupación automática por proximidad dentro del mismo espacio común.
- Indicador visual de quién está hablando (borde animado en el avatar).
- Control de mute/cámara on-off individual, accesible en todo momento (barra inferior tipo Zoom/Meet).

### 4.3 Interacción por clic en avatar
Al hacer clic en el avatar de otro usuario aparece un menú contextual con opciones (dependiendo de permisos y estado):
- **Llamar** → envía una solicitud de videollamada directa (1:1), tipo "ring".
- **Ir a su escritorio** → teletransporta tu avatar junto al de esa persona (si el mapa lo permite y hay permiso).
- **Ver perfil** → nombre, cargo, estado (disponible/en reunión/ausente).
- **Unirse a su sala** → si esa persona está dentro de un espacio delimitado y hay cupo/permiso.

### 4.4 Personalización (decoración)
- Catálogo de **assets** (muebles, plantas, alfombras, cuadros, mascotas virtuales, etc.).
- Sistema de "inventario" de objetos desbloqueados/comprados/asignados por el Admin.
- Editor drag & drop restringido al espacio propio del Empleado (su escritorio/oficina personal).
- El Admin puede decorar zonas comunes y la oficina completa.
- Personalización de avatar: piel, ropa, accesorios (estilo Gather/Bitmoji simplificado).

### 4.5 Gestión de espacios (Admin)
- Crear espacio delimitado (definir polígono/rectángulo en el mapa, nombre, capacidad máxima, tipo: privado/común).
- Asignar quién puede entrar (todos, un equipo, invitación explícita).
- Editar o eliminar espacios existentes.
- Vista de "quién está dónde" en tiempo real (dashboard de presencia).

### 4.6 Invitados
- Los invitados acceden mediante **link de invitación con expiración** (o código), sin necesidad de cuenta completa (opcional login simplificado).
- Aparecen únicamente en la "sala de invitados" (espacio delimitado especial).
- Solo pueden conversar entre ellos y con quien los invitó (o su equipo asignado).
- No ven el resto del mapa de la oficina (limitación de visibilidad, no solo de movimiento).

### 4.7 Presencia y estados
- Estados: Disponible, En reunión, Ausente, No molestar.
- Auto-detección de "en reunión" cuando está dentro de un espacio delimitado activo con audio.
- Historial simple de actividad (opcional, para analíticas del Admin).

### 4.8 Notificaciones
- Notificación in-app de llamada entrante.
- Notificación de escritorio (vía Web Push / Notification API) incluso con la app en segundo plano — clave para la experiencia como "programa instalado".

### 4.9 Grabación de reuniones
- Cualquier espacio delimitado (privado o común) debe poder **grabarse bajo demanda** (botón "Grabar" visible para quien inicia o para el Admin).
- Aviso visual a todos los participantes de que la sesión se está grabando (requisito legal/ético mínimo, aunque sea uso interno).
- La grabación se procesa y almacena en la **infraestructura propia** (no en servicios de terceros), en formato de vídeo estándar (MP4) con audio mezclado.
- Acceso a grabaciones: el Admin puede ver todas; el Empleado solo las de reuniones en las que participó (configurable).
- Consideración técnica: esto requiere que el SFU elegido soporte **Egress/Recording** de forma nativa (ver sección 6.3).

### 4.10 Integración con Google Calendar
- Sincronización de espacios/salas con **Google Calendar** para reservar una sala en un horario específico (evita choques de reuniones en salas con capacidad limitada).
- Al crear un evento en Google Calendar con un link de la oficina virtual, el evento debe reflejar disponibilidad/estado de la sala.
- Autenticación vía **Google OAuth 2.0** + Google Calendar API para leer/escribir eventos del usuario u organización.
- Notificación/recordatorio antes de la reunión con acceso directo (deep link) al espacio correspondiente dentro de la app.

---

## 5. Requerimientos no funcionales

| Categoría | Requisito |
|---|---|
| **Concurrencia** | Soportar 500 usuarios simultáneos por oficina (org), con picos de hasta 50-80 en un mismo espacio común |
| **Latencia audio/vídeo** | < 200ms percibido para conversación fluida (estándar WebRTC) |
| **Latencia de posición (movimiento)** | Sincronización de posición de avatares < 100ms para sensación fluida |
| **Disponibilidad** | 99.5%+ uptime para uso empresarial |
| **Seguridad** | Cifrado extremo a extremo o al menos TLS/DTLS-SRTP en medios; autenticación robusta; aislamiento de datos por organización (multi-tenant) |
| **Privacidad** | Cumplimiento básico tipo GDPR: permisos explícitos de cámara/micrófono, posibilidad de borrar cuenta y datos |
| **Instalabilidad** | PWA instalable en Chrome/Edge/Safari en Windows, macOS y Linux; ícono de escritorio, ventana propia sin barra de navegador |
| **Compatibilidad** | Funciona en navegadores modernos (Chrome, Edge, Firefox, Safari) sin plugins |
| **Accesibilidad** | Soporte de teclado completo, subtítulos opcionales (nice-to-have v2) |
| **Escalabilidad de infraestructura** | Arquitectura que permita escalar horizontalmente servidores de medios (SFU) por sala/oficina |

---

## 6. Arquitectura técnica propuesta

### 6.1 Frontend
- **Framework de UI:** React (o Vue) + TypeScript.
- **Motor del mapa/avatares:** **Phaser 3** o **PixiJS** (renderizado 2D con WebGL, ideal para tilemaps y sprites pixel art). Phaser es más completo para juegos 2D (colisiones, cámaras, tilemaps con Tiled).
- **Editor de mapas:** integración con **Tiled Map Editor** (formato `.json`/`.tmx` estándar de la industria) para que el Admin cargue/edite mapas sin reinventar la rueda.
- **PWA:** Service Worker (Workbox) + Web App Manifest para instalación en Win/Mac/Linux. Se recomienda **Vite PWA plugin** si el proyecto usa Vite.

### 6.2 Comunicación en tiempo real (posiciones, eventos, chat)
- **WebSockets** para sincronizar posición de avatares, estados, eventos de sala.
- Opciones de framework: **Colyseus** (game server framework diseñado justo para este caso: rooms, estado sincronizado, ideal para "espacios delimitados") o Socket.IO + lógica propia.
- **Recomendación:** Colyseus, porque ya modela el concepto de "Room" (mapea perfectamente a tus "espacios delimitados" y "espacios comunes") y maneja el ciclo de vida de salas de forma nativa.

### 6.3 Audio/Vídeo (WebRTC) — **Decisión: 100% self-hosted**
Esta es la parte más crítica técnicamente. Para 500 usuarios necesitas un **SFU (Selective Forwarding Unit)**, no P2P puro (P2P no escala más allá de ~4-6 personas por sala). Como se requiere **grabación de reuniones dentro de la app**, se descarta cualquier proveedor SaaS gestionado (Agora/Daily/Twilio) — estos cobran extra por grabación, la almacenan en su propia nube y limitan el acceso a los archivos crudos.

**Opciones self-hosted evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| **LiveKit (self-hosted, open-source)** | SDKs de JS listos, soporta salas/rooms de forma nativa, **Egress** integrado para grabación (graba a MP4/HLS y sube a tu propio S3), buena documentación, comunidad activa | Requiere gestionar tu propio clúster (LiveKit server + Egress service + TURN) |
| **mediasoup** (librería SFU en Node.js) | Control total, muy ligero, usado en varios clones de Gather open-source | La grabación NO es nativa — hay que implementarla a mano (ej. capturando streams con FFmpeg), mucho más trabajo de desarrollo |
| **Jitsi Videobridge (self-hosted)** | Maduro, con Jibri para grabación ya integrado | Stack más pesado, menos flexible para lógica custom de "proximidad" (está pensado como videollamada tradicional, no como motor de juego 2D) |

**Recomendación final: LiveKit self-hosted + LiveKit Egress.**
- **Egress** es el componente de LiveKit diseñado exactamente para esto: graba cualquier room a un archivo (MP4) o stream, y lo sube automáticamente a almacenamiento propio (S3/MinIO self-hosted).
- Se despliega en tu propia infraestructura (Docker/Kubernetes) — sin costo por minuto de terceros, control total de los datos de las grabaciones (importante si son reuniones internas sensibles).
- Requiere dimensionar bien los servidores: el SFU necesita CPU dedicada por participante activo, y Egress requiere recursos adicionales (transcodifica vídeo en tiempo real).

### 6.4 Backend / API
- **Node.js** (NestJS o Express) para API REST/GraphQL: gestión de usuarios, organizaciones, roles, invitaciones, assets.
- **Base de datos:** PostgreSQL (datos relacionales: usuarios, roles, organizaciones, espacios) + Redis (estado efímero: quién está online, en qué sala, cache de presencia).
- **Almacenamiento de assets:** S3-compatible (AWS S3, Cloudflare R2) para sprites, mapas, avatares personalizados.

### 6.5 Infraestructura y despliegue
- Contenedores Docker + Kubernetes (o simplemente Docker Compose para etapas tempranas, dado que es solo para una empresa y no multi-tenant).
- CDN para servir assets estáticos del juego (sprites, tilemaps) — opcional si todo corre on-prem/en una sola región.
- Servidores TURN/STUN propios (coturn), necesarios para que WebRTC funcione detrás de NATs corporativos (muy común en oficinas medianas con firewalls estrictos). Al ser self-hosted, coturn se despliega junto al resto del stack.
- **Almacenamiento de grabaciones:** servidor S3-compatible propio (MinIO) para que las grabaciones de LiveKit Egress queden 100% dentro de tu infraestructura, sin depender de un proveedor cloud externo (aunque también se puede apuntar a S3/R2 si se prefiere no mantener MinIO).
- Como es de uso interno para una sola empresa, se simplifica mucho la infraestructura: no hace falta aislamiento multi-tenant a nivel de red ni bases de datos separadas por cliente.

### 6.6 Diagrama de alto nivel

```
[Cliente PWA: React + Phaser]
        |         |
   WebSocket    WebRTC (media)
   (Colyseus)   (LiveKit SFU self-hosted)
        |         |                |
        |         |          [LiveKit Egress] → [MinIO/S3 grabaciones]
        |         |
[Backend Node.js / NestJS] --- [PostgreSQL] [Redis] [S3 assets]
        |                |
   [Auth / Roles /       [Google Calendar API]
    Invitaciones]         (OAuth 2.0)
```

---

## 7. Modelo de datos (entidades principales)

> Nota: al ser **single-tenant** (una sola empresa), no es obligatorio modelar `Organization` como entidad separada — pero se recomienda mantenerla igual como tabla simple (aunque sea una sola fila) para no cerrar la puerta a un futuro multi-tenant sin rediseñar todo el esquema.

- **Organization**: id, nombre, configuración general (una sola fila en el MVP).
- **User**: id, nombre, email, rol (admin/empleado/invitado), avatar_config, estado, google_account_id (para Calendar).
- **Office/Map**: id, tilemap_base_url (mapa prediseñado), versión.
- **Space** (espacio delimitado o común): id, map_id, tipo (privado/común/escritorio), polígono/coordenadas, capacidad_max, permisos (quién entra), google_calendar_resource_id (si es reservable).
- **Invitation**: id, email/link, rol asignado, expiración, estado.
- **Asset**: id, tipo (mueble/decoración/avatar), url_sprite, categoría (global, no hace falta separar por organización).
- **SpaceLayout**: id, space_id, assets colocados por el Admin sobre el mapa base (posición x,y, asset_id, rotación).
- **UserDeskConfig**: id, user_id, assets colocados en su escritorio (posición x,y, asset_id).
- **Recording**: id, space_id, iniciado_por (user_id), fecha_inicio, fecha_fin, url_archivo (en MinIO/S3), participantes (lista de user_id).
- **CalendarEvent**: id, space_id, google_event_id, organizador (user_id), fecha_inicio, fecha_fin.
- **Session/Presence** (en Redis, no necesariamente Postgres): user_id, space_id actual, posición x/y, estado (hablando/silenciado).

---

## 8. Flujos de usuario clave

1. **Onboarding Admin:** crea organización → elige plantilla de mapa o sube una → invita primeros empleados por email.
2. **Login Empleado:** recibe invitación → crea cuenta → entra directo al mapa de la oficina en su posición "home".
3. **Conversación por proximidad:** dos avatares se acercan → el audio sube gradualmente → se abre videollamada automática cuando están a distancia de "conversación".
4. **Entrar a sala privada:** avatar camina hacia el área delimitada → al cruzar el borde, se desconecta del audio ambiente y se conecta al audio del espacio → los de afuera dejan de escucharlo.
5. **Llamada directa por clic:** Empleado A hace clic en Empleado B → B recibe notificación de "llamada entrante" → acepta → se abre un modal de videollamada 1:1 (sin necesidad de moverse en el mapa) o A es teletransportado al lado de B.
6. **Invitado:** recibe link → entra a "Sala de Invitados" → solo ve/escucha a otros invitados y a quien lo invitó cuando se acerca a recibirlo.
7. **Decoración:** Empleado entra a modo edición en su escritorio → arrastra assets del catálogo → guarda → cambios visibles para todos en tiempo real.

---

## 9. Requerimientos específicos de PWA (instalación multiplataforma)

- **Web App Manifest** (`manifest.json`) con íconos en múltiples resoluciones (192px, 512px, maskable icons).
- **Service Worker** con estrategia de cache para assets estáticos (sprites, UI) — NO cachear WebSocket/WebRTC (no aplica).
- Botón "Instalar app" nativo usando el evento `beforeinstallprompt` (Chrome/Edge en Windows/Linux) y guía manual para Safari en macOS (que tiene soporte parcial de instalación PWA).
- Ventana en modo `standalone` (sin barra de direcciones) al abrir como app instalada.
- Verificar permisos de cámara/micrófono persistentes tras instalación (comportamiento distinto en app instalada vs. navegador).
- Soporte de **notificaciones push del sistema operativo** incluso con la app cerrada (para llamadas entrantes) — requiere Push API + Service Worker + backend con web-push.

---

## 10. Seguridad y privacidad

- Autenticación: **Google OAuth 2.0** como método principal (ya que se integra con Calendar) + email/password como fallback para invitados sin cuenta de Google.
- Al ser single-tenant, no se requiere aislamiento estricto entre organizaciones — pero sí control de acceso por rol dentro de la única organización.
- Cifrado de medios en tránsito (DTLS-SRTP, estándar de WebRTC).
- Los invitados no deben poder acceder a URLs de la oficina sin invitación válida (tokens con expiración, no adivinables).
- **Grabaciones:** almacenamiento cifrado en reposo, acceso restringido por rol (ver sección 4.9), y aviso obligatorio a los participantes cuando una sesión se está grabando.
- Auditoría: log de quién invitó a quién, quién editó espacios, quién inició/detuvo una grabación (para el Admin).

---

## 11. Métricas de éxito (KPIs)

- Tiempo promedio diario de uso por usuario activo.
- Nº de conversaciones espontáneas (por proximidad) vs. reuniones agendadas tradicionalmente.
- Tasa de adopción de la instalación PWA (vs. uso solo en navegador).
- Latencia percibida (encuestas + métricas técnicas de WebRTC).
- Retención semanal/mensual de organizaciones.

---

## 12. Roadmap sugerido por fases

**Fase 0 — Prototipo técnico (4-6 semanas)**
- Mapa básico con Phaser + movimiento de avatar + WebSocket de posición.
- Despliegue de LiveKit self-hosted (server + TURN) + integración mínima de audio/vídeo por proximidad (sin roles, sin persistencia).
- Prueba de concepto de LiveKit Egress grabando una sala de prueba a MinIO/S3.

**Fase 1 — MVP funcional (2-3 meses)**
- Roles (Admin/Empleado/Invitado) + autenticación con Google OAuth.
- Espacios delimitados y comunes configurables por Admin (sobre el mapa base prediseñado).
- Decoración básica del escritorio propio y de espacios (assets sobre el mapa base).
- Grabación de reuniones funcional de extremo a extremo (botón grabar → archivo accesible después).
- PWA instalable.

**Fase 2 — Producto interno completo (2-3 meses adicionales)**
- Integración con Google Calendar (reserva de salas, deep links a eventos).
- Catálogo de assets ampliado para decoración.
- Analíticas de uso para Admin (incluyendo historial de grabaciones).
- Notificaciones push, estados avanzados.

**Fase 3 — Escalado y mejoras**
- Optimización de infraestructura para +500 usuarios concurrentes.
- Mejoras de UI del reproductor de grabaciones (búsqueda, recorte, compartir internamente).
- Pizarras colaborativas, compartir pantalla mejorado.

---

## 13. Riesgos y consideraciones

- **WebRTC self-hosted a escala es la parte más costosa y compleja técnicamente** — al no usar un SaaS gestionado, todo el mantenimiento de disponibilidad, escalado y parches de seguridad del SFU recae en el propio equipo. Es el riesgo #1 del proyecto.
- **Grabación (Egress) consume recursos adicionales** — cada grabación activa requiere CPU extra para transcodificar en tiempo real; hay que dimensionar servidores pensando en cuántas salas se graban simultáneamente, no solo en usuarios conectados.
- **Almacenamiento de grabaciones crece rápido** — vídeo con audio de reuniones diarias puede acumular varios GB/semana; se necesita política de retención (ej. borrar automáticamente después de X días) para no saturar el storage propio.
- **Firewalls corporativos** pueden bloquear UDP/WebRTC — necesario tener TURN server robusto (coturn) como fallback.
- **Cuotas de Google Calendar API** — revisar límites de la API para no toparse con rate limits si hay muchos eventos/sincronizaciones simultáneas.
- **Safari/macOS** tiene soporte más limitado de instalación PWA que Chrome/Edge — gestionar expectativas del usuario mac.

---

## 14. Decisiones de producto (definidas)

| # | Pregunta | Decisión | Impacto en el proyecto |
|---|---|---|---|
| 1 | ¿Multi-tenant o una sola empresa? | **Solo para una empresa** (single-tenant) | Simplifica el modelo de datos y la infraestructura (sección 6.5 y 7); no hace falta aislamiento estricto entre organizaciones |
| 2 | ¿Plan de monetización? | **Gratis por el momento** | No se necesita sistema de billing/planes/paywalls en el MVP; se puede reconsiderar más adelante sin bloquear el desarrollo actual |
| 3 | ¿Self-host o proveedor gestionado de vídeo? | **Self-host**, porque se necesita **grabar reuniones dentro de la app** | Se elige **LiveKit self-hosted + Egress** (sección 6.3); se agregó O6 (grabación) y sección 4.9 con el requerimiento funcional completo |
| 4 | ¿Integración con calendario? | **Sí, con Google Calendar** | Se agregó O7 y sección 4.10; requiere Google OAuth 2.0 y uso de la Google Calendar API |
| 5 | ¿Editor de mapas 100% visual o plantillas? | **Híbrido:** mapa base prediseñado + assets modificables por encima | Reduce el alcance del editor (no hace falta un editor de tiles completo) manteniendo personalización real; ver sección 4.1 |

---

*Fin del documento. Siguiente paso sugerido: validar la arquitectura técnica de la sección 6 (en especial LiveKit self-hosted + Egress, por ser el mayor riesgo técnico y de infraestructura) y comenzar con la Fase 0 — prototipo de mapa + audio por proximidad + prueba de grabación end-to-end.*
