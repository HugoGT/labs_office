# Servidor Colyseus — avatares reales

Sincroniza por WebSocket la posición de los avatares **reales** (PRD 6.2). Los
NPCs simulados del cliente no pasan por aquí: son decorado local.

## Arrancar

```bash
pnpm server          # ws://localhost:2567  (PORT lo cambia)
pnpm test:server     # tests de integración: servidor y cliente reales
```

El cliente lo descubre solo: sin configuración apunta a `ws://<host>:2567`. Para
apuntar a otro sitio, `VITE_COLYSEUS_URL`; ponerla **vacía** desactiva el
multijugador a propósito. Si el servidor no está levantado la oficina no se
rompe: cae a modo solitario con los NPCs y la barra inferior muestra
`⚪ Sin servidor`.

## Por qué estas versiones y no las últimas

Tres trampas, todas verificadas contra el registro y con un round-trip real:

1. **No existe cliente JS para el servidor 0.17.** `colyseus@0.17` usa
   `@colyseus/schema@4`, pero el último `colyseus.js` publicado es 0.16.22 y
   habla `@colyseus/schema@3`. Son protocolos de codificación distintos. Por eso
   el servidor se queda en la línea 0.16.
2. **`@colyseus/core@0.16.25` está publicado roto**: su manifiesto declara
   `@colyseus/greeting-banner@workspace:^`, es decir, el protocolo `workspace:`
   se filtró al publicar. pnpm lo rechaza. El override de `pnpm-workspace.yaml`
   lo fija en 0.16.24, la última sana.
3. **No se usa el meta-paquete `colyseus`**, solo `@colyseus/core` +
   `@colyseus/ws-transport`. Aquel arrastra `@colyseus/uwebsockets-transport`,
   que depende de `uWebSockets.js` desde un repo git, y pnpm bloquea
   dependencias exóticas en subdependencias.

Al subir de versión, comprobar los tres puntos antes que nada.

## Decisiones que no se ven en el código

**El schema no usa campos de clase.** `@colyseus/schema` instala accesores en el
prototipo; un campo de clase real —lo que emiten tanto `useDefineForClassFields`
como el borrado de tipos de Node— crearía una propiedad propia que los tapa y
rompe la serialización *en silencio*. Por eso los campos se declaran con una
`interface` fusionada con la clase, que no emite nada, y el alta va por la
factoría `createPlayerState`.

**El cliente no es de fiar.** Cada `move` se valida y se recorta contra los
límites del mundo antes de tocar el estado. Un mensaje parcialmente válido se
descarta entero: aplicar solo el eje bueno dejaría al avatar en una posición que
nadie pidió. Igual con el nombre (se recorta) y los enumerados (caen a su valor
por defecto).

**TypeScript aparte.** `tsconfig.server.json` no es `composite` porque el
servidor y el cliente comparten ficheros de `src/game` y con proyectos composite
un mismo fichero no puede pertenecer a dos. Lo ejecuta Node borrando tipos, y
por eso los imports llevan extensión `.ts` explícita.
