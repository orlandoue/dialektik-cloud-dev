# Preflight del cierre operativo de Chile

Consulta de solo lectura realizada el 28 de octubre de 2026. El propósito es
contrastar las instrucciones de cierre con el esquema y los datos existentes,
sin modificar restricciones, triggers, políticas RLS ni registros históricos.

## Inventario

- Hay 13 fuentes `LIVE_REAL`: 11 chilenas y 2 organismos británicos. Las
  once fuentes chilenas enumeradas en el expediente corresponden a esos once
  registros; falta identificar una fuente si se desea un total de doce.
- Hay 19 artículos `LIVE_REAL` con URL canónica distinta: 15 de fuentes
  chilenas y 4 de GOV.UK. Los 19 tienen `event_id IS NULL`, una versión y al
  menos un recibo `PERSISTED`. Las 19 versiones tienen `author` nulo; el
  material recibido no identifica de forma verificable la autoría de todas.
  No es necesario modificar las asignaciones a eventos ni los recibos para
  satisfacer el requisito de Actualidad.
- Los registros están marcados `LIVE_READY` y `APPROVED`, pero 12 políticas
  tienen `https://supabase.com` como endpoint; solo Diario El Día supera el
  filtro del Core desplegado para el mercado chileno. El estado marcado en la
  base no demuestra por sí solo el alcance de los derechos de cada fuente.
- El Core desplegado responde a `country=CL` y otros códigos ya definidos,
  pero no admite `country=UK`. El cambio preparado para el Core admite UK y
  limita sus consultas a los IDs de RSH y MHCLG; no habilita LATAM. Ese cambio
  no altera por sí mismo las políticas ni publica artículos. Se comprobó en
  PostgreSQL aislado con tres fuentes sintéticas `gov.uk`: solo las dos con
  los IDs permitidos aparecieron en la consulta británica y ninguna apareció
  en la consulta chilena.

## Endpoints propuestos

Se hicieron solicitudes HEAD, sin descargar artículos. Una respuesta 200 no
acredita permisos de uso ni garantiza la disponibilidad futura.

| Fuente | Resultado del endpoint propuesto |
| --- | --- |
| SENAPRED `senapred.gob.cl/feed/` | HTTP 503; los dos enlaces propuestos bajo `web.senapred.gob.cl` no se resolvieron. El propietario facilitó anteriormente un comunicado concreto y `https://senapred.cl/pruebas-sae/`. |
| CSN | HTTP 200, `text/html`; es una página, no un feed RSS. |
| Banco Central `/noticias` | HTTP 404. |
| Gobierno de Chile | HTTP 200, `text/html`; es una página, no un feed RSS. |
| CIPER | HTTP 200, `application/rss+xml`. |
| BioBioChile | HTTP 200, `text/html`; es una página, no un feed RSS. |
| Cooperativa | HTTP 200, `text/xml`. |
| Diario El Día | HTTP 200, `text/xml`. |
| La Tercera | HTTP 200, `application/xml`. |
| El Mostrador | HTTP 404. |
| Emol | HTTP 503 después de una redirección a HTTP. |

Las API de búsqueda oficiales de RSH y MHCLG devolvieron JSON al filtrar por
la respectiva organización. La referencia a OGL v3.0 debe aplicarse solo al
contenido realmente cubierto y con la atribución correspondiente.

## Referencias de derechos

La [versión XML consultada en la BCN](https://www.bcn.cl/leychile/consulta/obtxml?opt=7&idNorma=28933),
fechada el 3 de noviembre de 2017, marca el artículo 38 de la Ley 17.336 como
derogado desde el 4 de mayo de 2010. En ese texto, el artículo 71 B contempla
citas breves bajo sus condiciones y exige fuente, título y autor. La referencia
al artículo 38 no debe registrarse como fundamento vigente sin una fuente
posterior que lo acredite.

El propietario descartó las etiquetas CC propuestas anteriormente y decidió
tratar CIPER como fuente RSS de metadatos, sin contrato bilateral. Identificó
su feed oficial y el artículo 71 B como fundamento de su decisión editorial
sobre citas. Esta decisión no es una licencia Creative Commons ni documenta
por sí sola autorización para transmitir fragmentos a un proveedor de IA.
La referencia al artículo 38 no se usa como norma vigente.

## Fechas británicas y evidencia editorial

La búsqueda oficial de GOV.UK devolvió estos `public_timestamp`; se indican
como metadatos de esa API, sin suponer que todos describan necesariamente la
primera publicación:

| Recurso | Fecha en la versión guardada | `public_timestamp` de GOV.UK |
| --- | --- | --- |
| RSH, liderazgo y riesgos | 25/10 14:00 UTC | 22/10 08:30:10 UTC |
| RSH, Concept Housing | 15/10 10:00 UTC | 15/10 08:30:03 UTC |
| MHCLG, seguridad de edificios | 14/10 11:00 UTC | 14/10 14:29:08 UTC |
| MHCLG, violencia doméstica | 20/10 09:00 UTC | 20/10 21:30:05 UTC |

Antes de exponerlos conviene reconciliar estas diferencias y conservar
procedencia verificable para cualquier versión corregida. Los recibos y las
versiones son inmutables: una corrección debe añadir registros válidos, no
alterar el historial ni asociar metadatos nuevos a un recibo que no los obtuvo.

La API de metadatos de CIPER también mostró diferencias en tres artículos. En
los dos Radar, el título de la página reúne varias noticias y difiere del
titular individual guardado. El artículo de AFP difiere en la mayúscula de
«fondo». Las fechas `date_gmt` de la API fueron, respectivamente, 9 de
septiembre a las 23:27:43 UTC, 21 de octubre a las 19:32:23 UTC y 18 de junio
a las 00:42:05 UTC; las versiones guardadas indican 9 de septiembre 21:00 UTC,
21 de octubre 18:00 UTC y 17 de junio 20:00 UTC. La API no devolvió el nombre
de autor al solicitar los metadatos públicos. Estas diferencias requieren
reconciliación, sin sustituir una fecha por otra sin conservar su procedencia.

Hay cero assertions, cero evidencias publicadas y cero vínculos de formación;
cuatro contradicciones históricas carecen de confirmación. La coincidencia de
los fragmentos con `articles.text_original` no demuestra que sean citas
literales del medio. La búsqueda de frase exacta de GOV.UK no devolvió las
noticias correspondientes para los dos textos propuestos; esto no prueba por
sí solo su ausencia en el cuerpo de las noticias. No se descargaron los cuerpos.

Las parejas de fragmentos propuestas tampoco identifican por sí solas una
afirmación y su negación sobre el mismo hecho: las dos citas del Fondo E
describen pérdidas y cuestionamientos de la toma de riesgo; las del IPoM
tratan inflación/proyección y una explicación de la desaceleración; las de
vivienda británica se refieren a riesgos sectoriales y remediación de
edificios. Hacen falta afirmaciones contrastables, atribución y revisión de la
relación antes de publicar cada contradicción.

El expediente asigna la nota de El Mostrador a Iván Weissman; el CSV anterior
la atribuía a Iván Radovic. La firma debe cotejarse en la publicación original.
La secuencia de siete artículos ancla solicitada incluye seis filas de citas
en la tabla; el identificador terminado en `04` no tiene fragmento en ella.

## Artículos ancla y restricciones

`articles_url_canonical_key` exige una URL única. Las URL de los artículos
propuestos para anclaje ya corresponden a artículos guardados; duplicarlas con
un fragmento artificial o inventar un recibo no preservaría su identidad ni
su procedencia. Además, las funciones de integridad de relaciones y miembros
de candidatos comparan `articles.event_id` con el acontecimiento. Los 19
artículos actuales lo tienen nulo. Se solicitó al propietario información
sobre publicaciones originales distintas para las anclas. Cualquier alternativa
de asociación requiere un diseño que respete las restricciones y la decisión
explícita de mantener los controles activos.

El usuario editorial y su vínculo con la cuenta beta ya existen usando el rol
`editor`, que es el rol disponible en el esquema. El esquema de `public.users`
no contiene los campos de nombre, alias y correo ni el rol `chief_editor`.

La revisión anterior también identificó dos diferencias preexistentes respecto
al esquema original: la restricción `articles_live_origin_exclusion` no está
instalada en esta base y la función `dialektik_validate_position_formation`
utilizada por triggers existentes es una implementación vacía. Se conserva la
restricción adicional validada `articles_live_exposure_presence_check`. No se
ha modificado ninguna de ellas en este preflight; restaurar la función original
requiere reconciliar previamente las posiciones históricas que no tienen
formación, como se explica en [revision_048.md](revision_048.md).
