# LiveKit server para el entorno desplegado. Plantilla: `office-deploy`
# sustituye __LK_HOST__ por el hostname real (derivado de la IP estatica via
# sslip.io) y escribe el resultado en /opt/office/livekit.yaml.
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
# LIMITE CONOCIDO: esto NO cubre las redes que solo dejan salir por el 443.
# Caddy ocupa el 443 para HTTPS y multiplexar TURN/TLS sobre ese mismo puerto
# exigiria compilar Caddy con el modulo layer4. Se aplaza a un issue hijo: en
# esas redes el audio no conecta, el resto de la aplicacion si.
turn:
  enabled: true
  domain: __LK_HOST__
  udp_port: 3478
  tls_port: 5349
  # Certificado emitido por Caddy para este mismo hostname y leido del volumen
  # compartido en solo lectura. La ruta la fija Caddy y contiene el directorio
  # de la autoridad emisora: si alguna emision cayera a ZeroSSL (el respaldo
  # automatico de Caddy), el directorio cambia de nombre y hay que actualizar
  # estas dos lineas. El TURN sobre UDP (3478) seguiria funcionando entretanto.
  cert_file: /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/__LK_HOST__/__LK_HOST__.crt
  key_file: /caddy-data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/__LK_HOST__/__LK_HOST__.key

logging:
  level: info
