# Revisión del tercer expediente 048

Fecha: 28 de octubre de 2026. SHA-256 del SQL recibido: `de94842006c9468856203fbf0524bdd1b81d6b1355d77fa80b2c3f136b11babb`.

El expediente conserva las 42 propuestas por mercado y aporta ocho descripciones de posturas, nombres de fuentes y emisores. El usuario indica que no existen contratos bilaterales privados y que el flujo RSS funciona solo con metadatos, sin descargar cuerpos de artículos. La revisión se hizo respetando esa separación; las referencias adicionales de derechos figuran en [condiciones_chile.md](condiciones_chile.md), [condiciones_regionales.md](condiciones_regionales.md) y [pistas_condiciones_42.csv](pistas_condiciones_42.csv).

## Comprobación del archivo

- Se comprobaron 102 cadenas de 26 caracteres en formato ULID Crockford sin desbordamiento. No se encontraron órdenes para eliminar restricciones o conceder permisos a `PUBLIC`, `anon` o `authenticated`.
- Se ejecutó el archivo únicamente en una base PostgreSQL temporal y vacía creada con las 41 migraciones registradas del repositorio. Las fuentes se insertaron dentro de la transacción, pero el siguiente paso falló con `prospective rights fence is internal technical state`. La transacción no se confirmó y el entorno temporal se eliminó. **El archivo no se ejecutó en Supabase.**
- La función de la barrera de derechos en Supabase sigue activa. Inserta automáticamente las filas técnicas al crear fuentes y rechaza la inserción directa del paso 1, incluso si se usa `ON CONFLICT DO NOTHING`.
- Si se corrigiera únicamente ese paso, el SQL aún usaría IDs ULID de 26 caracteres para las ocho exclusiones, mientras la regla vigente exige hashes SHA-256 de 64 caracteres. Los dos recibos de GOV.UK usan `govuk_content_api`, pero la restricción admite `rss_atom` u `official_api` para registros nuevos. Las ocho versiones proponen extractos pese a usar `METADATA_ONLY`.
- El bloque dinámico no inserta `claim_spans` ni vínculos `position_formed_by`; en el esquema real, campos obligatorios como `claim_span_id` y `anchor_span_id` no reciben los IDs correspondientes. Los errores de inserción se capturan con `EXCEPTION WHEN OTHERS` y el bloque continúa, por lo que un `COMMIT` no demostraría la existencia de la cadena editorial. El archivo tampoco inserta o confirma posiciones ni contradicciones, a pesar de anunciarlas en el encabezado.
- Las comprobaciones al final cuentan noticias y acontecimientos con joins parciales; no reproducen la política más reciente, el mercado, la formación de las dos posiciones, las evidencias aprobadas y la confirmación editorial exigidas por el Core del PR.

## Identificadores y datos observados en Supabase

La [correspondencia de los ocho candidatos](correspondencia_expediente_048_3.csv) muestra los IDs propuestos y los registros encontrados en la consulta de solo lectura. La correspondencia de posturas se basa exclusivamente en **acontecimiento y rango**; debe revisarse editorialmente antes de considerarlas equivalentes. Puede actualizarse el diagnóstico con [`verificar_correspondencias_048_3.sql`](verificar_correspondencias_048_3.sql), que ejecuta solo lecturas y no devuelve fragmentos.

- Los cuatro `event_id` propuestos existen. Ninguno de los ocho IDs de posiciones `01J111…` ni de los cuatro IDs de contradicción `01J222…` indicados en el expediente existe en la base. Hay ocho posiciones y cuatro contradicciones con otros IDs y con los mismos acontecimientos.
- Los ocho recursos propuestos ya aparecen como artículos `LIVE_REAL` con URLs canónicas sin el sufijo `#event-anchor-*`. Cada uno tiene un recibo con `disposition = PERSISTED` en la base. Eso demuestra la existencia del recibo, no que se haya reconstruido o validado una adquisición independiente. Crear nuevos anclajes con fragmentos de URL duplicaría esos recursos.
- Ninguna de las ocho citas propuestas aparece literalmente en el `text_original` del artículo ya almacenado ni en el `text_original` del artículo propuesto por el propio SQL. Esto no permite concluir qué dice el artículo original, que no se descargó; para crear `claim_spans` hacen falta fragmentos comprobados y offsets coherentes.
- Las ocho posiciones almacenadas carecen de `published_by` y de vínculos de formación; las cuatro contradicciones carecen de `confirmed_by`. La tabla editorial `public.users` no contiene usuarios. Las personas e instituciones citadas en el expediente identifican emisores o fuentes; no aportan un identificador de usuario editorial que haya confirmado los registros en Dialektik.
- Las políticas más recientes de las ocho fuentes de los candidatos todavía tienen `https://supabase.com` como endpoint. En total hay 13 fuentes actuales y 19 artículos; sus 19 versiones mantienen extractos bajo `METADATA_ONLY` y requieren conciliación.

La comparación con la base temporal también detectó que faltaban las claves foráneas del publicador de una postura y del confirmante de una contradicción. Se restauraron ambas y se añadió una comprobación `NOT VALID` que exige confirmante para escrituras futuras, sin modificar las cuatro contradicciones históricas. La comparación posterior encontró las 292 claves foráneas de la referencia con sus definiciones coincidentes. El script aplicado está en [`restore-editorial-actor-integrity.sql`](../restore-editorial-actor-integrity.sql). La tabla `public.users` sigue vacía y no hay sesiones activas de moderación; ninguna persona fue creada o atribuida automáticamente. Supabase Auth sí tiene una cuenta y hay una cuenta beta habilitada: son mecanismos distintos del usuario editorial.

## Fuentes, contraste y derechos

Las ocho URLs sin fragmento respondieron HTTP 200 a solicitudes HEAD en esta consulta. HEAD no verifica los textos, su autoría, el contenido de un feed ni el derecho de reutilización. La API pública de búsqueda GOV.UK confirmó los títulos y enlaces de los dos documentos británicos; sus valores `public_timestamp` difieren de los tiempos fijos del SQL y deben contrastarse con la fecha que se quiera registrar. No se descargaron cuerpos de artículos.

El par ENADI/SAE aportado describe empleo y preparación ante emergencias; con la información presentada no queda explicada una contradicción entre una misma afirmación. Los documentos británicos describen riesgos regulatorios y medidas de remediación que podrían coexistir; también requieren una proposición comparable y confirmación humana antes de publicarse como contradicción.

El texto del expediente describe 16 fuentes gubernamentales, cinco abiertas y 21 RSS; las 42 filas del SQL clasifican 18, cinco y 19, respectivamente. La clasificación de un canal o la cita de una ley no establece por sí sola el alcance de reutilización o de cita en cada jurisdicción. La ausencia de acuerdo bilateral indicada por el usuario no implica que siempre se necesite uno: hace falta registrar, para cada uso, una base verificable y sus condiciones. Las 35 URLs de evidencia que apuntan a portadas no documentan por sí solas esa decisión.

## Estado y siguiente paso

Se mantienen las 42 propuestas como inventario, el RSS de metadatos sin persistencia y los datos existentes. Antes de escribir nuevos registros editoriales se necesita una revisión de las fuentes concretas, los fragmentos y su relación, así como un usuario editorial real que pueda confirmar la publicación. También debe resolverse el modelo que conecta el artículo existente con el acontecimiento sin retirarlo de Actualidad ni duplicar su URL.
