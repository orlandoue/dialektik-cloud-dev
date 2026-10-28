# Revisión de los archivos 048 y del catálogo propuesto

Actualizado: 28 de octubre de 2026 UTC. SHA-256 del segundo SQL recibido: `a32c05cea3b8612d0048e4660ef69cde92ca4d928f4f3052ab4fda6c2f740a3b`. El primer SQL revisado tenía SHA-256 `c6aa991568a43d6a18c455104f657105bf0f57ef4132fb15b2594e483dccceab`.

El usuario confirmó conservar las **42 propuestas**. El CSV contiene las 13 fuentes existentes de Chile y Reino Unido y las 29 adicionales (Argentina 6, México 4, Colombia 5, Perú 5, Brasil 5 y Uruguay 4). Las 13 primeras ya figuran en Supabase; las 29 adicionales no se han activado. El CSV recoge los identificadores, enlaces y referencias de la versión corregida; las autorizaciones de uso siguen sin verificarse.

## Qué mejora la segunda versión

- Se retiraron las instrucciones para eliminar restricciones y otorgar permisos a `PUBLIC`, `anon` o `authenticated`.
- Las 42 fuentes usan identificadores distintos con sintaxis ULID válida; las 82 cadenas de 26 caracteres examinadas cumplen también el alfabeto Crockford y el límite de 128 bits.
- Las políticas proponen un campo `market` y el TypeScript agrupa dominios por mercado.
- Los cuatro artículos ancla tienen ahora sentencias de inserción. El archivo propone además inserciones dinámicas para afirmaciones y evidencias.

## Por qué el segundo SQL no se ha aplicado

- Se proponen 42 políticas activas con `rightsReviewStatus = APPROVED` y `rights_verified_at = NOW()`, pero las referencias suministradas no demuestran por sí mismas la autorización para los usos solicitados. Treinta y cinco enlaces de evidencia son portadas. La legislación mencionada o que el enlace pertenezca al medio no equivale automáticamente a una licencia de almacenamiento, extracción o análisis.
- Las 13 políticas existentes coinciden con IDs del archivo. El `ON CONFLICT DO UPDATE` pretende modificar sus registros de procedencia; el mecanismo original de inmutabilidad se restauró posteriormente en Supabase. Una corrección de políticas debe crear una nueva versión, conservar la anterior y respaldarse en la revisión correspondiente.
- Los cuatro artículos apuntan a URLs con `#event-anchor`, incluyen textos y extractos bajo políticas `METADATA_ONLY` y usan valores de hash con patrones fijos que el material no acredita como derivados de una adquisición real. Se necesitan recibos y fragmentos procedentes de registros y autorizaciones verificables.
- Aunque el comentario anuncia `occurrences`, `claim_spans`, vínculos de formación, posiciones y publicaciones de contradicción, no hay sentencias que los inserten. En el esquema real, la construcción dinámica usa el texto de la afirmación como valor de campos obligatorios que requieren IDs, como `claim_span_id` y `anchor_span_id`. Además, captura todos los errores y continúa, de modo que un `COMMIT` no demostraría que los registros se crearon.
- La comprobación final no reproduce todos los filtros del Core, ni verifica que cada posición tenga formación humana y evidencia publicada. En el proyecto, la regla original para artículos `LIVE_REAL` exige `event_id IS NULL`, mientras la lectura de acontecimientos requiere una vinculación a un artículo. Esta discrepancia de arquitectura necesita resolverse sin duplicar URLs ni fabricar registros.
- El TypeScript propuesto sustituiría exportaciones utilizadas por el controlador y el repositorio. Usa `UK`, que no es un mercado admitido por el contrato actual, y la aplicación mantiene los demás mercados como no disponibles. La separación por país se conserva en el catálogo, sin activar fuentes ni presentarlas como autorizadas.

## Estado observado y protecciones restauradas

La consulta de Supabase del 28 de octubre encontró 13 fuentes `LIVE_REAL`, 19 artículos y 19 versiones. Las 19 versiones tienen extracto pese a que su política indica `METADATA_ONLY`; los textos y extractos existentes no se han borrado ni alterado. Doce políticas aún tenían `https://supabase.com` como endpoint. No había artículos con los cuatro IDs ancla, afirmaciones, fragmentos, evidencias ni vínculos de formación; las ocho posiciones existentes carecían de formación y las cuatro contradicciones de confirmación completa.

Se observaron 21 funciones de disparadores sustituidas por implementaciones que solo devolvían `NEW`. Se restauraron 20 a partir de las migraciones oficiales en dos transacciones con precondiciones y comprobaciones con reversión:

- [`restore-live-provenance-guards.sql`](../restore-live-provenance-guards.sql): ocho funciones de procedencia, identidad, retención futura y protección de derechos, y una fila técnica faltante de la barrera de derechos.
- [`restore-editorial-audit-guards.sql`](../restore-editorial-audit-guards.sql): doce funciones de auditoría, atribución humana e integridad editorial.

Sigue pendiente `dialektik_validate_position_formation`, utilizado por ocho disparadores. La función de comprobación original falla sobre las ocho posiciones ya existentes; activarla sin resolver esos datos bloquearía operaciones posteriores del grafo editorial. La recuperación debe preservar la autoría y evitar inventar evidencia. La aplicación de las funciones no elimina ni modifica los artículos o las publicaciones anteriores.

Además se restauraron 19 restricciones independientes de integridad del flujo persistido mediante [`restore-live-integrity-checks.sql`](../restore-live-integrity-checks.sql). Diecisiete se validaron contra los datos existentes. Las otras dos protegen nuevas escrituras con `NOT VALID`: 19 exclusiones históricas tienen IDs que no son hashes SHA-256 y cuatro recibos históricos usan un canal distinto de `rss_atom` y `official_api`. Estos registros requieren conciliación y siguen intactos. Se mantiene aparte la restricción de artículo y acontecimiento por la discrepancia de arquitectura descrita arriba.

Se compararon las restricciones públicas con una base PostgreSQL temporal creada mediante las 41 migraciones registradas en el proveedor del repositorio. Esa comparación permitió restaurar también la regla de retractación de contradicciones con [`restore-contradiction-retraction-check.sql`](../restore-contradiction-retraction-check.sql). De las reglas de referencia, permanece sin restaurar la de artículo y acontecimiento; tres están presentes como `NOT VALID`, incluidas las dos del párrafo anterior y la de metadatos de publicación de posiciones. El entorno temporal no contenía datos de usuarios y se eliminó después de la comparación.

El Core preparado para el PR limita la proyección y búsqueda de extractos a las políticas cuya columna `storage_policy` lo permite. Esto no borra los textos ya guardados y requiere desplegar el cambio para surtir efecto en Render.

## Comprobaciones técnicas de los endpoints

La revisión inicial usó solo solicitudes HTTP HEAD, sin descargar cuerpos de artículos: 29 respuestas 200, 4 redirecciones, 4 respuestas 404, 4 respuestas 503 y 1 respuesta 405. De las 29 respuestas 200, 17 indicaron `text/html`. La versión corregida cambió el endpoint de Folha: HEAD respondió 200 con `text/xml` y redirigió a `www1.folha.uol.com.br`. HEAD puede ser tratado de forma distinta que GET; estos resultados no demuestran derechos, el contenido del feed ni la disponibilidad continua.

## Alcance

El CSV no modifica Supabase ni activa adquisición o análisis. No se ha ejecutado ninguno de los dos archivos 048. La separación entre el RSS en vivo de metadatos y el flujo persistido se mantiene.
