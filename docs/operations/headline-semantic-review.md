# Revisión semántica de titulares

Esta ruta es una propuesta de implementación. La migración 048, la ruta nueva
y la interfaz de titulares no están instaladas ni habilitadas en producción
por este documento. No aplica la migración SQL aportada con el mismo número
en el expediente del usuario.

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
fragmentos de titulares y sus posiciones; si no hay evidencia suficiente o
el modelo inventa una, la trata como tal. Los intentos son únicos por versión,
autorización y configuración; los fallos inciertos no se reintentan en silencio.
Existe además un límite global de 100 intentos por 24 horas.

El editor puede aceptar una observación para una futura comparación, pedir
más evidencia o rechazarla. Estas acciones no crean eventos, afirmaciones,
posturas o contradicciones públicas. En esta etapa aún faltan la comparación
entre titulares de fuentes distintas, la detección de contradicciones y su
conexión con la publicación que ya exige evidencias válidas. El análisis de
un titular no basta por sí solo para sostener una contradicción.

## Preparación para desplegar

1. Revisar y probar la migración en PostgreSQL aislado. Conciliar el historial
   del migrador con la base antes de aplicarla: allí hay objetos instalados
   fuera de Kysely. No asumir que `kysely_migration` esté completo.
2. Crear una cuenta de base de datos dedicada, sin privilegios administrativos,
   que herede únicamente los roles de lectura Core y `dialektik_headline_ai_writer`.
   Configurar su conexión como `HEADLINE_AI_DATABASE_URL` en el servidor; no
   compartirla con clientes ni mezclarla con la conexión editorial existente.
3. Configurar `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` en Render,
   sin incluirlos en el APK ni en el repositorio. Antes, probar una inferencia
   sintética y comprobar que el token permite Workers AI en la cuenta indicada
   desde la IP de salida real del servicio. Una IP permitida en otro entorno
   no demuestra que Render pueda acceder.
4. Desplegar el Core y la aplicación, mantener
   `DIALEKTIK_HEADLINE_REVIEW_ENABLED` apagado hasta comprobar las conexiones y
   los permisos, y habilitarlo solo tras la instalación y validación. El editor
   revisa el fundamento de cada fuente y la habilita expresamente en la app.
5. Probar una noticia real desde una fuente habilitada, comprobar el recibo,
   la revisión y las respuestas públicas, y registrar los resultados reales.
   Si no se dispone de evidencia suficiente, no crear citas ni contradicciones
   artificiales para llenar la interfaz.
