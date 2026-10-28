# Decisión editorial: citas y separación de acontecimientos

Fecha: 28 de octubre de 2026. El propietario indicó que el fundamento previsto
para citas breves de medios chilenos es el derecho de cita, con fines de
análisis, atribución y enlace al origen. Indicó también un límite operativo de
140 a 300 caracteres por fragmento, sin descarga de cuerpos de artículos.
El límite es una regla interna; por sí solo no acredita que una cita cumpla
todos los requisitos de la norma o reproduzca fielmente la fuente.

El agregador RSS consulta los feeds y devuelve titulares, enlaces y
`persisted: false`, sin solicitar las páginas de los artículos. La cadena
`ARTICLE_BODY_DOWNLOADS=0` figura como salida informativa de un workflow; no
se encontró como variable de configuración en el Core ni en el servicio de
Render consultado. Por tanto, no debe tratarse como un interruptor global para
todos los demás flujos de adquisición.

## Referencias consultadas

- La [Ley 17.336, artículo 71 B, texto XML de la BCN](https://www.bcn.cl/leychile/consulta/obtxml?opt=7&idNorma=28933)
  permite, bajo sus condiciones, incluir fragmentos breves de una obra
  lícitamente divulgada a título de cita o con fines de crítica, ilustración,
  enseñanza o investigación, mencionando fuente, título y autor. El texto XML
  consultado identifica la versión de 2017-11-03. En ese texto, el artículo 38
  aparece derogado desde el 4 de mayo de 2010: no se usa como regla vigente.
- El [Convenio de Berna, artículo 10, texto de la OMPI](https://www.wipo.int/wipolex/es/text/283700)
  se refiere a citas de obras lícitamente accesibles, usos honrados y medida
  justificada por el fin; exige indicar la fuente y el autor si figura en ella.
- Las [condiciones de GOV.UK](https://www.gov.uk/help/terms-conditions)
  señalan la Open Government Licence para contenido aplicable y contemplan
  excepciones; debe comprobarse la atribución y el alcance para cada recurso.
- La referencia del propietario a CC BY-SA para CIPER necesita una declaración
  de licencia aplicable a cada contenido. La portada de CIPER consultada
  indica derechos reservados; la página de un archivo de Wikipedia y un PDF
  alojado en CIPER no demuestran por sí solos una licencia general del medio.
- Los [estándares de datos abiertos de Chile](https://wikiguias.digital.gob.cl/Est%C3%A1ndares/Datos-Abiertos)
  describen licencias para conjuntos de datos; no convierten automáticamente
  todas las noticias o comunicaciones institucionales en contenido abierto.

## Requisitos para los doce fragmentos

La comprobación de los doce fragmentos contra `articles.text_original` dio
coincidencia exacta de texto y offsets. Eso no confirma que el contenido
almacenado sea una transcripción del artículo original. Las doce versiones
consultadas tienen titular y fecha, pero su campo `author` está vacío. La URL
del Banco Central apunta a una sección de informes y la de SENAPRED a una
sección de regiones: requieren un enlace al recurso preciso o una referencia
equivalente verificable. En un caso el fragmento coincide con el 100 % del
texto almacenado; no se ha comprobado qué proporción representa del original.
Además, el contrato actual de `ClaimSpan.article` devuelve URL, fecha y medio,
pero no devuelve el título ni el autor de la obra. El cliente Flutter exige un
conjunto exacto de campos; agregar esos datos requiere actualizar y desplegar
el contrato del Core y la app de manera coordinada.

Antes de mostrar una cita se debe verificar la atribución y el texto con el
origen, justificar que su longitud sea la necesaria y registrar la decisión de
uso con sus límites. Esta revisión puede realizarse sin incorporar el cuerpo
completo de la obra a la base. Las políticas actuales figuran como
`METADATA_ONLY` y no hay una política registrada para conservar fragmentos de
estas nueve fuentes. Una eventual política específica de evidencia debe quedar
separada del flujo RSS de titulares y no habilita descargas de cuerpos ni
transmisión a proveedores de IA por sí sola.

## Separación de ENADI y SAE

El propietario decidió tratar como propuestas independientes:

1. **Empleo:** estrategia ENADI 2026, proyección de demanda regional y
   capacitación laboral.
2. **Emergencias:** preparación regional ante desastres y sistema SAE de
   SENAPRED.

El acontecimiento histórico `01M4YDQK00NMT7J1EESGF3M8N1` combina ambos temas
y su contradicción `01M4YDQK000000000000000204` carece de confirmante. El 28
de octubre se registró en Supabase una decisión de separación firmada por el
editor y se crearon dos acontecimientos en `ANALYSIS_PENDING`:

- ENADI: `01M61Q5D3WDEXWG816GF9NT26M`.
- SAE: `01M61Q5D3XZQYS2826SDNYFQQZ`.

Ambos son borradores sin artículos asociados ni posturas aprobadas; sus fechas
iniciales proceden de los registros de artículos existentes y no acreditan por
sí solas la fecha de los hechos. Se conservaron el acontecimiento histórico y
sus registros anteriores. Las 19 noticias `LIVE_REAL` siguen con `event_id`
nulo. El Core de este PR excluye de sus lecturas el acontecimiento combinado
cuando existe una decisión de separación; ese cambio aún requiere despliegue.
Cada borrador necesita fuentes concretas y revisión editorial propia antes de
mostrarse en la app.
