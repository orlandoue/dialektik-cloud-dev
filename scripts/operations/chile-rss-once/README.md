# Ingesta puntual RSS/Atom de Chile

Este procedimiento ejecuta un lote puntual para `dialektik-dev`: seis fuentes
de prensa de Chile y los 32 canales de YouTube del catálogo editorial. Usa la
política vigente de cada fuente, consulta `robots.txt`, valida HTTPS y limita
cada feed a 2 MB y 200 entradas. YouTube puede quedar sin respuesta por la
restricción de red de la máquina ejecutora; los errores se registran por fuente
y no impiden procesar los demás feeds.

Para fuentes con `METADATA_AND_FEED_EXCERPT`, conserva el título y la
descripción que el propio feed publica, limitada a 700 caracteres. Para las
fuentes `METADATA_ONLY`, procesa solo metadatos. No descarga páginas de
artículos ni transcripciones de videos. El sitemap de El Mostrador no entrega
extractos y las rutas RSS propuestas para ese medio responden 404, por lo que
continúa en modalidad de metadatos.

El lote detecta URLs canónicas existentes en toda `public.articles`, omite
colisiones, agrega una versión append-only a artículos existentes de la misma
fuente y crea filas para publicaciones nuevas. Para fuentes con una política
vigente y aprobada `METADATA_AND_FEED_EXCERPT`, proyecta la última versión como
`headline + '. ' + excerpt` en `articles.text_original` y normaliza el mismo
texto. La migración 056 audita cada cambio y lo rechaza si la fuente ya tiene
claim spans o propuestas semánticas activas; en ese caso la versión nueva queda
en `live_article_versions` sin alterar offsets históricos. Los extractos se
limitan a 700 caracteres y no se descargan artículos ni transcripciones.
La escritura revierte el lote completo si falla una comprobación. El token de
gestión debe estar disponible solo para el operador en `SUPABASE_ACCESS_TOKEN`;
nunca se imprime ni se guarda en el repositorio.

## Ejecución

Desde la raíz del repositorio y con `SUPABASE_ACCESS_TOKEN` configurado:

```bash
npm run build
python3 scripts/operations/chile-rss-once/ingest.py prepare
python3 scripts/operations/chile-rss-once/ingest.py dry-run
python3 scripts/operations/chile-rss-once/ingest.py apply
```

La preparación guarda temporalmente el manifiesto en
`/tmp/dialektik-rss-metadata-once`; puede cambiarse con
`DIALEKTIK_RSS_RUN_DIR`. Caduca a los 15 minutos, queda firmado con una clave
aleatoria local de permisos privados y se elimina al aplicar el lote. La
aplicación exige que el mismo manifiesto haya pasado la simulación. No se
reutilizan lotes anteriores ni se crean duplicados por URL.

La red local puede bloquear YouTube. En ese caso, ejecuta el workflow manual
`Chile YouTube metadata feed fetch` desde GitHub Actions. El runner consulta
`robots.txt`, valida HTTPS y el host, limita cada Atom a 2 MB y guarda en el
artefacto de un día únicamente titulares, fechas, URLs y descripciones del feed
limitadas por el parser; no guarda el XML bruto ni usa secretos de Supabase.
Descarga el artefacto `chile-youtube-feed-manifest` y aplica el lote localmente:

```bash
npm run build
python3 scripts/operations/chile-rss-once/ingest.py prepare-youtube-manifest \
  --manifest /ruta/al/youtube-feed-manifest.json
python3 scripts/operations/chile-rss-once/ingest.py dry-run
python3 scripts/operations/chile-rss-once/ingest.py apply
```

La preparación vuelve a validar la firma del manifiesto, su antigüedad, los 32
IDs y los endpoints contra la política actual de Supabase. Genera IDs y la
firma de escritura en el entorno local, vuelve a consultar colisiones de URLs
y exige simulación antes de aplicar. El workflow solo recoge los vídeos
publicados hoy en Chile; no descarga páginas ni transcripciones.

Esta herramienta es manual; no configura un programador. Para operación
periódica hace falta un trabajador con credenciales de escritura limitadas y
un mecanismo de programación. No debe colocarse el token de gestión en el
servicio web como sustituto de ese diseño.
