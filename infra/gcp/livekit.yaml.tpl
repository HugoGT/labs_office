# LiveKit server para el entorno desplegado. Plantilla: `office-deploy`
# sustituye __LK_HOST__ y __TURN_HOST__ por los hostnames reales (derivados de
# la IP estatica via sslip.io) y escribe el resultado en
# /opt/office/livekit.yaml.
#
# Las claves NO viven aqui: entran por la variable LIVEKIT_KEYS que el compose
# toma de /opt/office/.env, y ese fichero lo regenera cada despliegue leyendo
# Secret Manager. Este fichero es commiteable.
#
# Diferencias deliberadas con infra/livekit/livekit.yaml (la PoC local):
#   - hay IP publica y certificados, asi que el TURN embebido se enciende
#   - el rango UDP es el completo, no los 20 puertos de la PoC
#   - no hay seccion `redis`: un solo nodo y sin Egress no coordina nada

port: 7880

rtc:
  tcp_port: 7881

  # Rango completo. La PoC publicaba solo 50000-50019 porque publicar 10.000
  # puertos con el mecanismo de Docker hacia que el arranque tardase minutos;
  # aqui el contenedor corre en la red del host y no publica nada, asi que el
  # motivo de aquel recorte desaparece y el rango vuelve a ser el habitual.
  port_range_start: 50000
  port_range_end: 60000

  # La VM tiene NAT 1:1 de GCE: la interfaz solo ve la IP interna y los
  # candidatos ICE anunciados con ella no sirven de nada desde fuera. Con esto
  # LiveKit descubre la IP publica y anuncia esa. En la PoC iba en false porque
  # en localhost no hay nada que descubrir.
  use_external_ip: true

# TURN embebido, no coturn.
#
# El PRD 6.5 pedia coturn propio y infra/livekit/README.md dejo la decision
# abierta a proposito. Se resuelve aqui a favor del TURN embebido: es el camino
# que documenta el propio proveedor, comparte las claves y el ciclo de vida del
# SFU, y evita mantener un servicio mas con su propia configuracion y sus
# propios certificados.
#
# Cubre ahora tambien las redes que solo dejan salir por el 443 (issue #19).
# Caddy multiplexa TURN/TLS y la senalizacion sobre ese mismo puerto (modulo
# layer4, ver el bloque `layer4` de Caddyfile), mirando solo el SNI del
# ClientHello: turn.* va al TURN de aqui debajo, todo lo demas sigue su camino
# de siempre.
turn:
  enabled: true

  # Hostname propio para el TURN, distinto del de senalizacion (issue #19). Es
  # lo que permite que el multiplexor del 443 separe el TURN del WebSocket de
  # senalizacion mirando SOLO el SNI: los dos viajan por el mismo puerto y son
  # indistinguibles hasta que se mira el nombre de servidor del ClientHello.
  #
  # El navegador NO conoce este nombre por el bundle del SPA: lo recibe en la
  # lista de servidores ICE que devuelve la propia senalizacion de LiveKit. Por
  # eso este cambio no toca ni una linea del cliente.
  domain: __TURN_HOST__

  udp_port: 3478
  tls_port: 5349

  # Caddy termina el TLS (ver el bloque layer4 del Caddyfile) y entrega texto
  # claro en el 5349. LiveKit deja de leer certificados del disco: eso retira
  # office-cert-watch y, de paso, el montaje de solo lectura que le daba acceso
  # a TODAS las claves privadas de Caddy, no solo a la suya.
  external_tls: true

  # Sin esto LiveKit veria como cliente al contenedor de Caddy y anunciaria esa
  # direccion en XOR-MAPPED-ADDRESS; Firefox rechaza ese candidato y el relay
  # queda inservible. La cabecera PROXY v2 la manda el handler `proxy` del
  # multiplexor. Solo existe desde v1.13.7 (ver el comentario junto al pin de
  # imagen en docker-compose.yml): v1.13.5 ignoraria esta clave en silencio.
  proxy_protocol: true

  # Solo la subred del bridge del compose, fijada a proposito en
  # docker-compose.yml. Sin fijarla, Docker elige una del pool y este valor
  # dejaria de cuadrar en la siguiente recreacion de la red, en silencio.
  proxy_protocol_trusted_cidrs:
    - 172.30.0.0/24

logging:
  level: info
