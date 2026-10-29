# Comparaciones editoriales de titulares

Esta etapa propone pares de titulares para revisión editorial. No crea
acontecimientos públicos, afirmaciones, citas ni contradicciones. Sus tablas,
ruta y pantalla requieren instalación y despliegue; la función está apagada
si `DIALEKTIK_CONTEXT_PAIR_ENABLED` no es `true`.

## Procedimiento

1. Solo se consideran versiones actuales de noticias reales con recibo
   `PERSISTED`, sin cuarentena y con una autorización de titulares vigente
   para cada fuente. Los pares deben provenir de medios distintos.
2. El Core busca al menos dos términos compartidos y una separación máxima de
   72 horas entre las publicaciones. Esa fecha acota la búsqueda: no se
   interpreta como la fecha del acontecimiento.
3. Cloudflare recibe únicamente los dos titulares y sus fechas de publicación.
   El modelo devuelve una sugerencia provisional de mismo acontecimiento, tema
   relacionado, sin relación o incierto. Para una relación posible, el Core
   identifica una palabra literal, única y no genérica presente en ambos
   titulares. Esta coincidencia es una pista, no prueba la relación propuesta.
4. La base y el Core verifican las autorizaciones, las versiones y los offsets.
   Se registran los intentos antes de enviarlos, sin guardar respuestas textuales
   del modelo. Hay un límite de 30 comparaciones por 24 horas y no se reintenta
   silenciosamente una pareja con la misma configuración.
5. El editor puede conservar una propuesta para revisión, pedir evidencia o
   descartarla. Conservarla no confirma que ambos medios narren el mismo hecho
   y no la publica. Si una autorización se revoca o una política cambia, la
   propuesta deja de ser revisable hasta que la fuente vuelva a autorizarse.

La búsqueda por términos puede omitir relaciones expresadas con palabras
distintas y puede proponer coincidencias que solo compartan nombres o temas.
El resultado del modelo puede ser incorrecto. Las fuentes originales siguen
siendo necesarias para verificar la relación y cualquier contradicción.
