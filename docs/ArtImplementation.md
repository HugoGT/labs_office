# Plan de implementación de la migración de arte

## Objetivo

Migrar el pack de arte de `../labs-worktrees/assets` a la oficina conservando la rejilla lógica de 32 px, incorporando el arte a escala nativa y extendiendo los módulos existentes para guardar personaje, materiales y colores.

El plan cubre los issues [#4](https://github.com/HugoGT/labs_office/issues/4), [#122](https://github.com/HugoGT/labs_office/issues/122) y [#123](https://github.com/HugoGT/labs_office/issues/123). Para cerrarlos completos también se necesita parte de [#121](https://github.com/HugoGT/labs_office/issues/121), que define el formato, la carga de imágenes y la elección de personaje utilizada por #122.

Este documento describe trabajo pendiente. Las recomendaciones de formato deben reconciliarse con #121 antes de implementarse.

## Punto de partida verificado

| Elemento | Pack nuevo |
|---|---|
| Personajes | 18, con 8 direcciones de marcha |
| Marcha | Frames de 32×52 px, 10 frames de paso y una columna de reposo |
| Sentado | Frames de 44×58 px, 6 de transición y 2 de reposo, en 4 orientaciones |
| Pisos | Patrones de 96×96 px: madera, césped, agua y piso coloreable |
| Mobiliario | 4 materiales de escritorio y 4 de silla, con 4 orientaciones |
| Paredes | Ladrillo, piedra, yeso y vidrio |

La oficina ya tiene autenticación, posiciones, espacios, escritorios, decoración y administración. Las extensiones pendientes son el avatar persistente, la apariencia persistente de pisos/escritorios, el nuevo render y las funciones de terreno y contribuciones que piden los issues.

## Orden de ejecución

**Contrato → exportadores → persistencia/catálogo → carga/render → login y animaciones → colores de creación → mapa y editor → subida/moderación → validación final.**

Cada etapa debe entregarse con sus pruebas de comportamiento. Este orden permite revisar el arte integrado temprano y construir las contribuciones sobre el mismo formato que ya utiliza la oficina.

## 1. Fijar el contrato de píxeles y formatos

Esta primera entrega evita que cada integración termine con escalas y offsets distintos.

- Mantener `TILE = 32` como unidad de coordenadas, colocación y límites.
- Dibujar personajes y muebles nuevos a escala 1:1.
- Separar tres conceptos: dimensiones del PNG, huella lógica de colocación o colisión y ancla visual de pies, asiento o punto de apoyo.
- Conservar las anclas del pack: marcha `(16, 47)` y pose sentada `(22, 42)`.
- Dividir cada patrón de piso de 96×96 en nueve tiles de 32×32, preservando su patrón completo.
- Adaptar el generador de paredes a segmentos de la rejilla de 32 px; su geometría actual utiliza segmentos de 96 px.

Hay que actualizar el contrato de #121: sus dimensiones anteriores no corresponden al pack nuevo. También exige alfa binaria y hasta 64 colores, mientras que este arte usa sombras/vidrio semitransparentes y los personajes medidos tienen hasta 75 valores RGBA distintos. El contrato nuevo debe admitir esa transparencia intencional y fijar límites compatibles con el pack.

**Resultado:** un formato versionado, con dimensiones, orientaciones, capas y anclas verificables.

## 2. Integrar y corregir los scripts de exportación

Trasladar los generadores puros a una ubicación del repositorio, por ejemplo `tools/art/`, y producir el pack en `public/assets/pack/`.

El exportador debe generar:

- Las hojas de marcha/reposo y sentado de los 18 personajes.
- Sillas con sus capas trasera y frontal separadas.
- Escritorios en sus cuatro orientaciones.
- Tiles de piso, piezas de paredes y un manifiesto.
- Una preview para revisar todas las piezas y sus combinaciones.

Cambios concretos frente a los scripts actuales:

- Exportación para producción a 1×; las ampliaciones quedan para previews.
- Quitar fondos y marcas de referencia de los archivos consumidos por la oficina.
- No aplanar las dos capas de las sillas.
- Incluir en el manifiesto IDs estables, archivos, formato, anclas, huella, autor y licencia.
- Verificar que regenerar el pack produce exactamente los mismos archivos.

**Resultado:** un pack reproducible, independiente de la demo y de archivos exportados manualmente.

## 3. Conectar el pack al catálogo y preparar la persistencia

Extender los puertos y adaptadores actuales de `decor`, `directory`, `desks` y `spaces`.

| Dato persistido | Propietario |
|---|---|
| Personaje elegido | Usuario |
| Material y color del escritorio | Escritorio |
| Material y color del piso | Espacio, incluido el cubículo asociado al escritorio |
| Metadatos y archivos de cada pieza | Catálogo |

Las migraciones deben ser idempotentes y asignar valores iniciales a las filas existentes.

El pack se registra con identidades estables. Su actualización debe conservar elecciones y colocaciones existentes, incluyendo piezas retiradas.

**Resultado:** las decisiones visuales sobreviven a reinicios, despliegues y cambios de dispositivo.

## 4. Sustituir la carga y el dibujado de assets

Actualizar principalmente:

- `src/game/assets.ts`
- `src/game/mapBuilder.ts`
- Los puntos de dibujo de `src/game/OfficeScene.ts`

El manifiesto pasa a determinar qué imágenes y frames se cargan.

Además:

- Dibujar cada pieza con su tamaño y ancla reales.
- Evitar estirar un escritorio para llenar su área lógica: un puesto de 3×3 tiles no implica un PNG de 96×96.
- Elegir la orientación exportada del mueble, en lugar de girar una imagen plana de perspectiva.
- Cargar piezas nuevas del catálogo durante la sesión.
- Redibujar una colocación cuando su textura termine de cargar.
- Mantener un fallback visible ante una carga fallida.

**Resultado:** el mismo catálogo alimenta las previews, los editores y la oficina.

## 5. Añadir la elección de personaje al acceso a la oficina

El flujo propuesto es:

**Autenticar → resolver nombre → seleccionar personaje → guardar elección → entrar a la oficina.**

- Mostrar los 18 personajes con preview de reposo, marcha y sentado.
- Las cuentas existentes también pasan por este selector en su primer acceso tras la migración.
- En siguientes inicios de sesión, presentar el personaje guardado como selección inicial.
- Una sesión restaurada conserva su elección; refrescar la página no obliga a elegir de nuevo.
- Guardar la elección en el servidor y validar que el personaje está disponible.
- Usar previews ligeras en React, sin cargar Phaser antes de entrar.
- Aplicar este paso al acceso a la oficina, conservando el acceso administrativo a `/dashboard`.

La selección persistida debe ser la que el servidor replica a los demás usuarios.

**Resultado:** quien elige un personaje lo ve localmente y todos los compañeros ven ese mismo personaje.

## 6. Integrar animación, anclas y poses sentadas

Adaptar `src/game/characters.ts`, `src/game/remoteAvatarSink.ts`, el protocolo compartido y el estado de Colyseus.

- Incorporar las ocho orientaciones de marcha.
- Separar su orden del de las cuatro orientaciones de sentado.
- Derivar la animación de marcha del movimiento; no enviar cada frame por red.
- Replicar el personaje elegido y una referencia validada al asiento cuando corresponda.
- Diferenciar tener asignado un escritorio de estar físicamente sentado.
- Componer correctamente: silla trasera → personaje → silla frontal.
- Actualizar retratos, etiquetas, anillos y áreas de clic para el nuevo tamaño.

La conversión entre posición de red, pies y cuerpo físico debe quedar definida en código compartido y contrastada con Phaser real. Así el cambio visual no desplaza inadvertidamente colisiones o pertenencia a espacios.

**Resultado:** caminar, detenerse, sentarse y levantarse se representan coherentemente en ambos clientes.

## 7. Hacer que material y color se elijan únicamente al crear

Añadir los selectores a los formularios de creación de escritorios y espacios.

- El escritorio pintado permite elegir color; madera, metal y vidrio conservan su material.
- El piso coloreable permite elegir color; los demás pisos mantienen su apariencia propia.
- La preview utiliza el mismo generador que el render definitivo.
- La creación guarda material y color junto con la entidad.
- Mover, renombrar, reclamar o liberar un escritorio conserva su apariencia.
- La decoración personal continúa siguiendo al usuario; el color del mueble pertenece al escritorio.
- Las rutas de actualización rechazan cambios de apariencia, conforme al requisito de elegirla solo al crear.
- Las texturas coloreadas se generan y cachean por combinación de material/color, no en cada frame.

**Prueba clave:** crear con un color, reiniciar el servidor, entrar desde otro navegador y comprobar que sigue siendo el mismo.

## 8. Migrar el mapa y completar #4 y #123

### Layout y arte definitivo — #4

- Incorporar un layout base Tiled `.json`, porque forma parte del alcance explícito del issue.
- Reservarlo para la geometría y colocaciones estáticas; la configuración administrada sigue teniendo su fuente de verdad en la base de datos.
- Sustituir suelo, paredes y mobiliario provisional.
- Completar árboles, plantas, puentes y otras piezas necesarias para retirar el arte provisional del mapa.

### Terreno por bloques — #123

- Ampliar a 126×90 tiles, equivalentes a 4032×2880 px.
- Organizar el terreno en 14×10 bloques de 9×9 tiles.
- Conservar las coordenadas actuales de espacios, escritorios y muebles.
- Completar tierra, arena, empedrado y moqueta: el pack actual todavía no contiene los ocho materiales solicitados.
- Sustituir las imágenes individuales de suelo por capas de tilemap con un tileset compartido.
- Generalizar las transiciones de la demo a vecinos arbitrarios, con esquinas y orillas orgánicas.
- Compartir entre cliente y servidor la regla efectiva de terreno transitable, incluyendo la precedencia de puentes y layout.

Después, implementar la fase 2:

- Persistencia de bloques y editor para Admin.
- Propagación de cambios a los clientes conectados.
- Rechazo de agua bajo colocaciones protegidas o jugadores.
- Un snapshot de terreno actualizado para validar movimiento, evitando consultar Postgres por cada `move`.

**Resultado:** mapa ampliado, editable y coherente entre render y colisiones.

## 9. Implementar subida y moderación para cerrar #122

Reutilizar el contrato y cargador anteriores:

1. Implementar primero la subida del Admin requerida por #121.
2. Validar PNG, dimensiones, límites y metadatos; recodificar antes de almacenar.
3. Guardar archivos inmutables por hash en almacenamiento dedicado para assets.
4. Añadir contribuciones de personajes y adornos desde Personalizar.
5. Incorporar `pending → approved | rejected`, autor, licencia aceptada y motivo de rechazo.
6. Mantener privadas las previews pendientes, incluidos sus archivos.
7. Crear la cola de revisión en `/dashboard`.
8. Aplicar el máximo de 5 pendientes por usuario y una cuota horaria con control de concurrencia.
9. Mostrar créditos y registrar las transiciones en auditoría.
10. Retirar personajes con fallback a uno por defecto; conservar adornos ya colocados según la semántica existente.

En despliegue, añadir la ruta específica `/assets/files/*` en `infra/gcp/Caddyfile`: `/assets/*` también contiene los bundles de Vite.

Antes de activar contribuciones deben quedar definidos el texto de cesión de derechos y la cuota horaria.

## 10. Verificar y desplegar por entregas

Cada etapa lleva sus pruebas de comportamiento. Las evidencias de cierre serían:

| Alcance | Evidencia necesaria |
|---|---|
| #4 | Layout Tiled consumido por la oficina y arte definitivo integrado |
| #123 | Mundo ampliado, transiciones, agua bloqueada en ambos lados y edición persistente visible entre clientes |
| #122 | Subida, privacidad de pendientes, aprobación/rechazo, cuotas, auditoría y retirada |
| Login | Cuenta existente elige personaje y otro cliente ve la misma selección |
| Colores | Material/color se conservan tras reinicio, movimiento y cambio de ocupante |

La validación final incluye regeneración del pack, revisión visual de los 18 personajes, pruebas unitarias/servidor/navegador, E2E de dos clientes y regresiones de audio y pertenencia a espacios. El despliegue debe introducir primero un backend compatible y después el cliente nuevo.

### Checklist de finalización

- [ ] El contrato versionado corresponde al pack real y está reconciliado con #121.
- [ ] Los exportadores generan el pack de forma determinista y a escala nativa.
- [ ] El catálogo y las migraciones conservan identidades y datos existentes.
- [ ] El login permite elegir personaje para cuentas existentes y persiste la selección.
- [ ] Los avatares locales y remotos muestran animaciones y poses coherentes.
- [ ] Los pisos y escritorios conservan el material/color elegido al crearlos.
- [ ] El layout Tiled y el arte definitivo cumplen el alcance de #4.
- [ ] El mapa por bloques y su editor persistente cumplen ambas fases de #123.
- [ ] Las contribuciones y la moderación cumplen los criterios de #122.
- [ ] La validación visual, las pruebas y las regresiones pasan antes del despliegue.
