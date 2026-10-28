# Revisión del cuarto expediente 048

Fecha: 28 de octubre de 2026. SHA-256 del SQL recibido: `556214896b6d8e9086becfdc63e60bfe5fc4182b7d730012a7cb5de15e2ccb50`.

## Usuario editorial y cuenta beta

Se creó en Supabase el usuario editorial solicitado `01M4YDQK00ED1T0R0R1AND0VE1` con el rol `editor`, que es el rol existente para confirmaciones editoriales. La tabla `public.users` solo almacena ID, rol y fecha: no incluye `chief_editor`, alias, nombre, correo ni estado `active`. El registro por sí solo no crea una sesión.

La cuenta de prueba indicada por el usuario existe en Supabase Auth, tiene el correo confirmado y acceso beta habilitado. Se creó una asociación explícita y revocable entre esa identidad y el usuario editorial. La tabla tiene RLS activo; `anon` y `authenticated` no tienen lectura directa y el Core solo tiene lectura, sin permisos para insertar, actualizar o borrar la asociación. El nuevo reconocimiento del JWT de esa cuenta está implementado en la migración 044 y en el Core de este PR; requiere desplegar el Core para estar disponible en Render.

Se verificó en PostgreSQL temporal que una identidad vinculada y habilitada puede autenticarse y que se rechazan tokens alterados, vencidos, cuentas sin vínculo y accesos revocados; las sesiones opacas existentes siguen funcionando. También se verificó la firma de un JWT real de la cuenta beta y su resolución al editor con el código nuevo y una base temporal. El actor se vuelve a consultar durante cada transacción editorial. La versión desplegada aún responde 401 en moderación para el JWT de la cuenta beta.

El flujo de moderación actual separa la propuesta de un moderador y su confirmación por un editor distinto. Además, el Core desplegado tiene permisos de lectura y no dispone de un rol de escritura editorial operativo. La interfaz de moderación existente es un componente interno de escritorio y no está conectado a la navegación de la beta. La asociación no equivale todavía a una aprobación publicada ni habilita por sí sola esas escrituras.

## Doce fragmentos y offsets

La comparación de solo lectura confirmó que **los 12 fragmentos** suministrados son subcadenas exactas del `text_original` almacenado y que sus offsets de inicio inclusivo y fin exclusivo coinciden. La comprobación se hizo contra la base, sin descargar artículos originales. Esa coincidencia no demuestra por sí sola que el texto guardado reproduzca literalmente la fuente externa.

[verificacion_fragmentos_048_4.csv](verificacion_fragmentos_048_4.csv) conserva IDs, offsets y SHA-256 de los fragmentos, sin volver a copiar sus textos. La consulta [verificar_fragmentos_048_4.sql](verificar_fragmentos_048_4.sql) permite repetir la comprobación sin mostrar los fragmentos. Los IDs de posición del expediente siguen siendo distintos de los existentes; la correspondencia por acontecimiento y rango es provisional y requiere revisión semántica.

El SQL recibido incorpora ocho fragmentos en su bloque de datos, no los cuatro apoyos adicionales presentes en el mensaje. Los doce artículos tienen `event_id IS NULL`, y las nueve fuentes involucradas carecen de un registro `content_access_policies` que establezca permisos para retener fragmentos o derivados. Las políticas de esos artículos figuran como `METADATA_ONLY`. La ausencia de acuerdo bilateral informada por el usuario no impone que se obtenga uno; debe registrarse una base de uso y sus alcances antes de persistir citas como evidencia.

El fragmento aportado para la postura B del Fondo E describe cuestionamientos a una toma de riesgo, mientras el título de esa postura atribuye a las administradoras una defensa de la cobertura. Esa cita, tal como está presentada, no demuestra esa defensa. Para ENADI y SAE aún falta explicar qué proposiciones contrapuestas versan sobre el mismo asunto.

## Estado del SQL

Las 111 cadenas de identificadores revisadas cumplen el formato ULID. El archivo no elimina restricciones ni otorga permisos públicos. En una base temporal creada desde las migraciones, la transacción se detuvo en la inserción directa de la barrera de derechos; no se ejecutó en Supabase.

El bloque dinámico del usuario escogería el primer valor del enum (`user`), no `editor`. El bloque de `claim_spans` no reconoce las columnas reales `text_offset_start` y `text_offset_end`, asigna el inicio a ambas y captura el fallo. Las posiciones propuestas `01J111…` no existen en Supabase, y el archivo no construye los vínculos `R01a` de formación ni las confirmaciones de contradicción. Los ocho anclajes ya tienen artículos con la misma URL canónica y los sufijos `#event-anchor` no crean recursos independientes. El archivo también propone extractos en versiones `METADATA_ONLY` y políticas activas aprobadas sin registrar la decisión específica de uso de fragmentos.

## Verificación funcional del entorno

Mediante una sesión temporal autorizada de la cuenta beta, el Core desplegado respondió HTTP 200 a las rutas de fuentes, noticias, cronología, feed y contradicciones. Las listas persistidas estaban vacías. En una segunda consulta, la cronología devolvió 20 titulares de Diario El Día y 15 de Cooperativa, limitada a 30 en total y con `persisted: false`; una consulta anterior había informado indisponibilidad temporal de Diario El Día. La sesión temporal se cerró al finalizar. No se utilizó ni almacenó la contraseña compartida en el chat.
