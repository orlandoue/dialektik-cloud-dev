# Ingesta puntual de metadatos RSS de Chile

Este procedimiento ejecuta un lote puntual para el proyecto de desarrollo
`vclsswwfhljczxgnsciq` y las cuatro fuentes revisadas: CIPER, Cooperativa,
Diario El Día y La Tercera. No instala un programador de tareas, no procesa
artículos con IA y no publica acontecimientos ni contradicciones.

Se consulta `robots.txt` y cada RSS por HTTPS, con tamaño acotado. El adaptador
del Core valida los enlaces y las fechas; se seleccionan como máximo 12
titulares recientes por medio. Solo se persisten titular, fecha, autor si el
RSS lo informa, enlace, recibo y huellas de procedencia. No se descargan
páginas de artículos ni se guardan extractos o cuerpos de texto.

La escritura requiere la política de metadatos vigente y aprobada de cada
fuente. Respeta las restricciones y triggers de la base, detecta las URL y los
identificadores de fuente existentes y no modifica los artículos previos. La
transacción revierte el lote completo si falla una comprobación. El token de
gestión tiene privilegios amplios: debe estar disponible solo para el operador,
en `SUPABASE_ACCESS_TOKEN`, y nunca imprimirse o incluirse en un repositorio.

## Ejecución

Desde la raíz del repositorio y con `SUPABASE_ACCESS_TOKEN` ya configurado:

```bash
npm run build
python3 scripts/operations/chile-rss-once/ingest.py prepare
python3 scripts/operations/chile-rss-once/ingest.py dry-run
python3 scripts/operations/chile-rss-once/ingest.py apply
```

La preparación crea un manifiesto de metadatos privado en
`/tmp/dialektik-rss-metadata-once`; puede cambiarse el directorio mediante
`DIALEKTIK_RSS_RUN_DIR`. El manifiesto caduca a los 15 minutos y queda firmado
con el token del operador. La aplicación exige que el mismo manifiesto haya
pasado la simulación. Una ejecución posterior vuelve a leer los RSS; no se
reutiliza el manifiesto anterior ni se fabrican recibos para entradas que ya
existen.

El primer lote de 48 artículos se ejecutó y verificó con este procedimiento
en desarrollo antes de añadir estas salvaguardas al programa reproducible. Una
segunda ejecución simuló el lote completo, omitió los 24 ya presentes y añadió
24 titulares nuevos de Cooperativa y La Tercera.
Para operación automática hace falta un trabajador con credenciales de
escritura limitadas y un mecanismo de programación; no se debe colocar el
token de gestión en el servicio web como sustituto de ese diseño.
