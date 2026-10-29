# Revisión semántica de titulares

La migración 048 de este repositorio se instaló en Supabase el 29 de octubre
de 2026, después de ensayarla en una transacción revertida. Se verificó RLS en
las cuatro tablas y la separación de permisos entre lectura, procesamiento y
moderación. Las tablas empezaron vacías. Esta migración no es el archivo SQL
aportado con el mismo número en el expediente del usuario.

La ruta nueva y la interfaz de titulares siguen en borrador y no están
habilitadas en producción. Se creó el usuario restringido del procesador y se
configuró su conexión en Render; falta verificarla desde el propio servicio.
Una inferencia sintética confirmó Workers AI en la cuenta indicada desde el
entorno de desarrollo, pero el token aún debe configurarse en Render.

## Alcance

El editor único puede habilitar o retirar el procesamiento de titulares para
una fuente a la vez. Cada habilitación conserva la política vigente, su
referencia y fundamento, editor, proveedor, fecha y alcance. Es una decisión
editorial interna; no afirma que exista una licencia de terceros ni que la
mera existencia de un RSS conceda permisos adicionales. Una nueva política
deja de servir para una autorización anterior hasta revisarla de nuevo.

Para una fuente habilitada, cada solicitud autenticada selecciona como máximo
una versión actual de una noticia real y no puesta en cuarentena, con recibo
`PERSISTED`. Al proveedor se envían su titular y hashes, y el cuerpo va vacío.
Se registra un intento antes de transmitir y un resultado después, sin guardar
el contenido textual de las respuestas del modelo. El sistema valida los
fragmentos de titulares y calcula sus posiciones y hashes en el servidor; si
no hay evidencia suficiente o el modelo inventa una, la trata como tal. Un
número ordinario no se admite como identificador sin un contexto explícito.
Los intentos son únicos por versión,
autorización y configuración; los fallos inciertos no se reintentan en silencio.
Existe además un límite global de 100 intentos por 24 horas.

En una prueba sintética con Workers AI, el modelo generó observaciones
verificables en dos de tres titulares con fecha explícita; el tercero quedó
como insuficiente. Otros tres titulares sin fecha ni identificador aceptable
quedaron como insuficientes. Estos resultados no miden el desempeño sobre las
noticias de producción.

El editor puede aceptar una observación para una futura comparación, pedir
más evidencia o rechazarla. Estas acciones no crean eventos, afirmaciones,
posturas o contradicciones públicas. En esta etapa aún faltan la comparación
entre titulares de fuentes distintas, la detección de contradicciones y su
conexión con la publicación que ya exige evidencias válidas. El análisis de
un titular no basta por sí solo para sostener una contradicción.

## Preparación para desplegar

1. La migración se probó en PostgreSQL aislado y se aplicó fuera de Kysely. La
   base no tenía `kysely_migration`; hay que conciliar el historial antes de
   ejecutar el migrador general y no volver a aplicar esta estructura.
2. La cuenta dedicada de base carece de privilegios administrativos y hereda
   los roles de lectura Core y `dialektik_headline_ai_writer`. Su conexión se
   configuró como `HEADLINE_AI_DATABASE_URL` en el servidor; falta verificarla
   desde Render. No compartirla con clientes ni mezclarla con la conexión
   editorial existente.
3. El identificador `CLOUDFLARE_ACCOUNT_ID` se configuró en Render; falta
   `CLOUDFLARE_API_TOKEN`. No incluir credenciales en el APK ni en el
   repositorio. Probar una inferencia desde el servicio: el éxito desde el
   entorno de desarrollo no demuestra el acceso desde Render.
4. Desplegar el Core y la aplicación, mantener
   `DIALEKTIK_HEADLINE_REVIEW_ENABLED` apagado hasta comprobar las conexiones y
   los permisos, y habilitarlo solo tras la instalación y validación. El editor
   revisa el fundamento de cada fuente y la habilita expresamente en la app.
5. Probar una noticia real desde una fuente habilitada, comprobar el recibo,
   la revisión y las respuestas públicas, y registrar los resultados reales.
   Si no se dispone de evidencia suficiente, no crear citas ni contradicciones
   artificiales para llenar la interfaz.
