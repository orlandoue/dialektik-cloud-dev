# Diagnóstico del motor y del CSV de publicaciones originales

Revisión realizada el 28 de octubre de 2026. Las consultas a Supabase fueron de
solo lectura. Los sitios se consultaron mediante HEAD y metadatos del encabezado
HTML; no se descargaron cuerpos de artículos para el análisis semántico.

## Inventario y ejecución

- Hay 11 fuentes chilenas y 2 británicas; los 19 artículos `LIVE_REAL` guardados
  siguen sin vincular a acontecimientos. Hay seis eventos en la base, que son
  registros históricos o borradores, no eventos agrupados por una ejecución
  reciente del motor.
- Las tablas tienen cero `claim_spans`, cero `assertions`, cero `evidence` y
  cero vínculos `position_formed_by`. Hay cuatro publicaciones históricas de
  contradicción sin confirmación y ninguna es una nueva detección del motor.
- No hay filas en `personal_owner_source_rights_decisions`,
  `personal_owner_source_connections`, `content_access_policies` ni
  `semantic_provider_runs`. El cociente de contradicción no se puede calcular
  para una ejecución que no existe; cero afirmaciones no implica cero conflictos
  observados por un detector.
- En Render, `SEMANTIC_MODE` es `disabled`; la configuración disponible no
  contiene credenciales de Cloudflare Workers AI ni de Gemini. El módulo
  semántico de producto se habilita solo para `fixture` fuera de producción y
  el proveedor V10.11 es una interfaz desactivada que no ejecuta inferencia.
- El motor LLM paralelo existe como procesamiento de sombra, pero el camino
  operativo está restringido a una instalación personal y local. El procesamiento
  de fragmentos requiere una decisión de derechos con alcances explícitos, una
  política de contenido y un proveedor configurado. `METADATA_ONLY` no habilita
  por sí solo la transmisión de fragmentos a un proveedor externo. No se deben
  desactivar las comprobaciones para aparentar una ejecución.
- El registro de políticas en `live.sync.ts` no incluye actualmente los campos
  `rightsReviewStatus` y `authorizationReference` que exige la lectura pública.
  Un puente de ingesta deberá transportar la decisión vigente verificable a la
  política emitida y respetar su revocación; cambiar solo el endpoint o el modo
  de ejecución no basta.

## Diagnóstico del RSS sin persistencia

Se consultaron los feeds después de comprobar sus instrucciones `robots.txt` y
se pasaron por el adaptador Core con `METADATA_ONLY`, sin almacenar artículos
ni extractos. Los resultados de esta muestra fueron: CIPER 16 titulares,
Cooperativa 15, Diario El Día 200 y La Tercera 100. No son artículos nuevos
guardados ni ejecuciones del motor semántico.

El feed de La Tercera exponía un fallo en el control de profundidad XML: el
contador interpretaba como etiquetas XML los fragmentos HTML incluidos en
CDATA. Se corrigió el escaneo para ignorar CDATA, comentarios, instrucciones
de procesamiento y signos `>` dentro de atributos. Se mantiene el límite de
32 niveles reales y el rechazo de declaraciones DTD y entidades. La muestra
del mismo feed pasó el adaptador después de la corrección, con 100 titulares
y cero extractos retenidos.

## Archivo de nueve publicaciones

Las nueve URL son distintas entre sí y ninguna coincide exactamente con las
URL actuales de `articles`. Los nueve fragmentos coinciden con los offsets
de sus respectivos textos en el CSV; esto comprueba la consistencia interna
del archivo, no su literalidad en la publicación de origen. Los nueve IDs de
postura del CSV no existen en la tabla `positions`. Dos fragmentos miden 315 y
318 caracteres, por encima del límite de 300 caracteres propuesto por el
propietario.

Se detectaron estas discrepancias al consultar metadatos públicos:

- BioBioChile, artículo del 20 de octubre: el CSV indica 10:37 UTC, mientras
  `article:published_time` indica 10:37:44 con huso -03:00 (13:37:44 UTC).
  En el artículo del 14 de octubre el CSV indica 20:39 UTC y el encabezado
  indica 20:39:38 con huso -03:00 (23:39:38 UTC).
- El artículo británico del Rent Standard está asociado en el CSV a MHCLG;
  la búsqueda oficial de GOV.UK identifica al Regulator of Social Housing como
  organización de la publicación. `public_timestamp` de GOV.UK también
  difiere de las fechas propuestas para las dos noticias británicas; ese campo
  no necesariamente representa la primera publicación.
- La página técnica de SENAPRED contiene el fragmento propuesto en sus
  metadatos, pero `article:published_time` indica 25 de agosto de 2025, no el
  21 de octubre de 2026 del CSV. La fecha puede tener un significado distinto
  en el archivo y debe reconciliarse.
- Algunos titulares coinciden con los metadatos del medio; otros contienen
  diferencias de puntuación, sufijos del sitio o metadatos insuficientes. La
  respuesta HTTP 200 no verifica autoría ni literalidad de un fragmento.

Estas publicaciones no se han convertido en artículos, recibos, citas,
afirmaciones ni evidencia. Las posturas y contradicciones deben surgir del
motor y pasar revisión editorial, según la instrucción del propietario.

## Procedencia de registros guardados

Cuatro URL de los artículos existentes respondieron HTTP 404 en esta revisión:
una de BioBioChile, dos de Cooperativa y una de Gob.cl. El resultado debe
revisarse de nuevo antes de considerarlo permanente.

El registro de Diario El Día `01M4YDQK000000000000000305` contiene un titular
sobre una desaladora de 2026. Su URL devuelve un encabezado canónico para una
noticia distinta: «65 años de historia en La Serena: los motivos del cierre de
la Estrella Alpina», de 2025. El cambio de Core permite registrar una cuarentena
por artículo en una versión nueva de la política de la fuente sin borrar ni
editar las 19 noticias, sus recibos, restricciones o triggers. La última
decisión explícita `quarantinedArticleIds` se mantiene aunque otra versión de
política omita ese campo; una nueva lista vacía revierte la cuarentena. Un
valor de tipo distinto de lista cierra la lectura de esa fuente.

## Contrato de Actualidad

La consulta incluye noticias `LIVE_REAL` con o sin `event_id`, manteniendo
los controles de fuente, derechos, recibo y mercado. El identificador del
acontecimiento no se expone en el DTO: `semantic_assignment` informa
`EVENT_LINKED` cuando exista vínculo, o `UNASSIGNED` en caso contrario; una
página que contenga un vínculo usa `semantic_mode: mixed`. Flutter acepta
ambos estados sin mostrar conclusiones semánticas.

Las APK anteriores solo aceptan `UNASSIGNED` y `unassigned`; deberán
actualizarse antes de consumir páginas que contengan noticias vinculadas.
El esquema original de la migración 017 y varios controles del motor de sombra
exigen `event_id IS NULL` para `LIVE_REAL`; esa restricción original no está
presente en la base actual. Hacer funcional el vínculo en otras instalaciones
requiere una solución de esquema compatible con las reglas de integridad y
con la decisión del propietario de conservar los controles.
