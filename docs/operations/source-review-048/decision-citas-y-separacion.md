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
almacenado sea una transcripción del artículo original. El propietario aportó
autores, títulos y enlaces en un CSV el 28 de octubre. El archivo original
contiene comas sin entrecomillar en cinco filas; los valores reconstruidos se
registran como propuestas en [atribuciones_propuestas_12.csv](atribuciones_propuestas_12.csv),
sin duplicar las citas. Cada fragmento coincide con el hash y los offsets que
se cotejaron en Supabase. Los doce títulos propuestos y once enlaces coinciden
con los registros consultados; las doce versiones tienen el campo `author`
vacío. El enlace propuesto para SENAPRED difiere del registrado en la base.

Los autores aportados aún no se han verificado contra las publicaciones. La
página de informes indicada por el propietario enlaza el
[IPoM de septiembre de 2026 en PDF](https://www.bcentral.cl/documents/33528/8619822/IPoM%20Septiembre%202026.pdf/a20e38ef-756a-3eb3-cd3a-a0bd8383e20b)
y su [resumen oficial](https://www.bcentral.cl/resumen-ipom/-/detalle/resumen-ipom-septiembre-2026).
Ambas direcciones respondieron a solicitudes HEAD, sin descargar el cuerpo del
informe; resta cotejar el fragmento y la autoría con el recurso específico.
El propietario aportó después el [comunicado de evacuación por el simulacro
de Magallanes del 16 de abril de 2026](https://senapred.cl/2026/04/16/masiva-evacuacion-en-comunas-costeras-de-la-region-de-magallanes-tras-simulacro-de-sismo-y-tsunami/)
y la [página técnica de pruebas SAE](https://senapred.cl/pruebas-sae/); ambos
respondieron HTTP 200 a solicitudes HEAD. El comunicado se refiere a una
fecha anterior a la del registro de noticia existente: la relación concreta
con el borrador SAE, la cita y la autoría aún requieren cotejo editorial.
El catálogo de mercado de Chile contempla `senapred.cl` además del dominio
histórico registrado; esa incorporación no crea una fuente ni aprueba su uso.
La página general de simulacros enlaza ejercicios regionales, por ejemplo
[Los Lagos, 27 de octubre](https://senapred.cl/simulacros_t/sev-los-lagos-2026/)
y [Atacama, 8 de octubre](https://senapred.cl/simulacros_t/sbc-atacama-2026/),
pero no se ha establecido que sean el origen del fragmento aportado. Una
respuesta HTTP 200 a una solicitud HEAD no acredita que una página contenga
una cita o autoría.
La búsqueda oficial de GOV.UK confirmó los cuatro títulos y enlaces británicos
y sus organizaciones publicadoras. Esa consulta de metadatos no confirmó los
equipos de autoría propuestos ni el texto literal de las citas.
La API de metadatos de CIPER devuelve para el artículo de AFP un título que
difiere en la mayúscula de «fondo», y para la página Radar un título general
distinto al propuesto en el expediente. El propietario identifica esa entrega
como «Radar: 09/09/26», con autoría de «Equipo Radar CIPER». Los títulos
devueltos por la API se conservan en el CSV de revisión; la API consultada no
proporcionó el nombre de autor. El propietario identifica la autoría del IPoM
como «Consejo del Banco Central de Chile».
En particular, `https://senapred.cl/sistema-alerta-de-emergencia/` devolvió
el mismo ETag y tamaño que una ruta inexistente elegida para comparación;
ese 200 no permite confirmar que el enlace corresponda a una página de SAE.
En un caso el fragmento coincide con el 100 % del texto almacenado; no se ha
comprobado qué proporción representa del original.
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
nulo. El Core desplegado desde este PR excluye de sus lecturas el acontecimiento
combinado cuando existe una decisión de separación.
Cada borrador necesita fuentes concretas y revisión editorial propia antes de
mostrarse en la app.
