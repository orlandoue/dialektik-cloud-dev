# Chile — fuentes oficiales candidatas para Dialektik, no habilitadas

**Revisión preliminar del 20-10-2026.** Esto NO acredita acceso automatizado, robots.txt ni derechos de almacenamiento. El registro máquina `chile-official-source-candidates-2026-10-20.json` mantiene todas las banderas de adquisición y escrituras en `false`.

## Resultado de la investigación

| Fuente | Interés | Derechos observados públicamente | Decisión |
|---|---|---|---|
| INE — Instituto Nacional de Estadísticas | Noticias económicas, inflación, empleo, demografía y estadísticas oficiales, Chile | El INE publica condiciones de su **sitio** bajo CC BY-SA 4.0 que admiten reutilización incluso comercial, con atribución y condiciones de licencia. No está verificado si existen exclusiones específicas de noticias, multimedia, logos o material de terceros; ni un feed/endpoint automatizable y reglas robots. | **CANDIDATA PRIORITARIA, NO HABILITADA** |
| SENAPRED | Emergencias, alertas y protección civil en Chile | Existe una sección pública de noticias con fecha y enlace. Robots, política de automatización y alcance de licencia **no verificados**. | **PENDIENTE, NO HABILITADA** |
| BCN — Biblioteca del Congreso Nacional | Actualidad legislativa y datos normativos | **Distinguir**: el sitio de contenidos periodísticos declara restricciones de reutilización **no comercial**; el portal separado de datos abiertos enlazados usa Creative Commons de atribución para **datasets**. No trasladar automáticamente permisos de datasets a noticias. | **NOTICIAS: NO HABILITADAS; DATOS: REVISAR POR SEPARADO** |

### Evidencia original

- INE sala de prensa: https://www.ine.gob.cl/sala-de-prensa y https://www.ine.gob.cl/sala-de-prensa/noticias .
- INE términos: https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos .
- SENAPRED noticias: https://senapred.cl/noticias/ .
- BCN contenidos de uso liberado: https://www.bcn.cl/portal/api-servicios/servicio/ObtenerNoticiaPorIdNoticiaHTML?id=contenidos-web-de-la-bcn-con-derechos-de-uso-liberados .
- BCN datasets de acceso abierto: https://datos.bcn.cl/es/informacion/lo-que-esta-haciendo-bcn .
- BCN portal de noticias: https://www.bcn.cl/portal/noticias .

## Condiciones imprescindibles antes de encender cualquier adaptador

1. Determinar licencia aplicable **a cada categoría de contenido** (titular, metadatos, cuerpo, imagen, material de terceros) y obligaciones de atribución/comercialidad/share-alike. Documentar fuentes y aprobación de titular de derechos o asesoría competente. Permitir solo el conjunto de campos expresamente autorizado.
2. Establecer ruta de adquisición **oficial/autorizada** (API, RSS, feed, sitemap o acuerdo específico), comprobar redirecciones, contenido, límites de uso, robots por agente y ruta, política de reintentos y mecanismo de revocación.
3. Crear comprobante de revisión con ID, fecha, versión de política, identidad del publisher y ruta, todo con acceso controlado. No aceptar los permisos declarados por una respuesta HTTP como prueba.
4. Probar adquisición read-only acotada, nueva URL real, repetición, corrección de titular, falla/redirección de fuente y robots desactualizado sin escribir en PostgreSQL.
5. Solo cuando RESTORE-GATE #4 esté realmente PASS y migraciones/roles estén aprobados, habilitar persistencia idempotente con permisos mínimos. La fuente debe poder apagarse independientemente.
6. Nunca inferir contradicciones o identidad de acontecimiento por compartir una palabra, número o nombre.

**Nota**: GOV.UK RSH es la única prueba previa de adquisición oficial efectiva y está limitada a siete URLs permitidas, no es evidencia de dos fuentes chilenas ya habilitadas. Las candidatas INE/SENAPRED/BCN permanecen fuera de todo job de adquisición.

Este registro es una **investigación para acelerar habilitaciones futuras**, no un aval jurídico ni licencia automática.
