# Dialektik — cierre remoto autónomo de Fase 1

Fecha de verificación: 2026-10-16, 08:39 UTC

Alcance: únicamente el proyecto de desarrollo Supabase `vclsswwfhljczxgnsciq` y el servicio Render `dialektik-core-dev`.

## Disposición

**FASE 1: BLOCKED — rotación segura del Core y comprobación HTTPS real pendientes.** No se habilitó el escritor ni se ejecutó la inserción. Ninguna migración, fila, variable de Render o despliegue fue modificada durante esta verificación.

`CORE_CREDENTIAL_ROTATION = BLOCKED_SECURE_SECRET_CHANNEL`

`CORE_HTTP_HEALTH = BLOCKED_NO_HTTP_RESPONSE`

`GOVUK_ONE_SHOT = NOT_RUN_SECURITY_GATES_UNMET`

`PHYSICAL_ANDROID_VERIFICATION = PENDING_OWNER`

## Checkout y publicación

- Checkout usado: `C:/Users/orlan/.codex/visualizations/2026/10/11/01a12950-84bd-7e31-87b0-3b11019e5b26/dialektik-govuk-rsh-13a5733`.
- Rama al inicio: `codex/govuk-rsh-one-shot-import`.
- HEAD al inicio: `f8a41047e0130ffe9081ebf52bfdf5beec37d4d6`.
- Estado inicial: sin cambios rastreados; ya existía el directorio sin seguimiento `.task-temp/`. Se dejó intacto.
- GitHub confirmó `orlandoue/dialektik-cloud-dev` privado. GitHub no encuentra el SHA local `f8a41047e0130ffe9081ebf52bfdf5beec37d4d6`; el servicio Render está configurado para `codex/v7i-operational-product-pipeline`, no para esta rama local.
- El commit desplegado más reciente que Render informa es `9353ab9819a8d865cdec53896f593bafdd8f80d2` (`dep-db8r6hc9v7es7397ijeg`, estado de control `live`, despliegue terminado correctamente el 2026-10-16 05:17:58 UTC). No demuestra salud HTTP actual.
- Este checkpoint se conserva en el checkout local. No se publicó ni se hizo push: la rama de Render usa auto-deploy por commit y el HEAD local no está en GitHub; no se debe provocar un despliegue mientras salud y rotación siguen sin verificar.

## Supabase y permisos

- El conector identificó el proyecto exacto como `dialektik-dev`, ref `vclsswwfhljczxgnsciq`, región `us-east-1`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- El plan de la organización propietaria figura como `free`.
- El ledger remoto conserva migraciones 041 (`20261016052229`) y 042 (`20261016074743`). No se aplicaron migraciones en esta iteración.
- Las ocho tablas consultadas (`sources`, `articles`, `events`, `live_source_policies`, `live_acquisition_receipts`, `live_article_versions`, `live_exposure_exclusions` y `prospective_content_rights_write_guards`) tienen RLS activo.
- Se observaron 14 políticas acotadas al escritor y 8 políticas de lectura del Core; no se observaron políticas para `PUBLIC`, `anon` ni `authenticated` sobre esas tablas.
- Verificación de permisos efectivos del escritor: inserción por columnas de título y URL canónica permitida; sin INSERT de tabla completa en `articles`; sin INSERT de excerpt; sin mutación de `articles`; sin INSERT en `events`, `semantic_occurrences` ni `semantic_observations`. `anon` y `authenticated` no tienen SELECT sobre `articles`. La consulta de `information_schema.role_table_grants` no devolvió grants de tabla para `PUBLIC`, `anon` o `authenticated` en las tablas de este flujo.
- `dialektik_core_app`: LOGIN, no superusuario, sin CREATEDB/CREATEROLE/BYPASSRLS/replicación, sin membresías y cero sesiones observadas en la consulta.
- `dialektik_govuk_metadata_writer`: NOLOGIN, sin atributos administrativos ni membresías y cero sesiones observadas. No se habilitó.
- Recuentos después del preflight: Sources 0; Articles 0; Events 0; políticas 0; recibos 0; versiones 0; exclusiones 0; guards de derechos 0; coincidencias del artículo objetivo 0.

## Render y HTTP

- Servicio: `dialektik-core-dev`, ID `srv-db6tpp4s728c73evcptg`, instancia `free`, no suspendida, URL `https://dialektik-core-dev.onrender.com`.
- Se intentó GET, sin credenciales, a `/health/live`, `/health/ready`, `/live/news` y `/live/sources` mediante navegador remoto y cliente HTTP local. El navegador indicó URL inaccesible; el cliente local terminó con `HttpRequestException` sin respuesta HTTP. No hay status HTTP que reportar.
- Métricas de Render para `/health/live` y `/health/ready` entre 08:00–08:40 UTC devolvieron series vacías; los logs de solicitudes filtrados para esas rutas entre 07:34–08:34 UTC no mostraron solicitudes. Por eso no se infiere 200, 401, caída del Core ni disponibilidad a partir de `deploy=live`.
- No se obtuvo un bearer de tester o un token de Core por un canal que mantenga el secreto fuera de argumentos y respuestas. No se probaron rutas autenticadas.

## Bloqueo del canal de rotación

El conector Render disponible solo ofrece `update_environment_variables` con `value: string`; esa entrada sería visible para el agente como argumento. El conector Supabase SQL ejecuta la consulta enviada como argumento. No hay en las herramientas conectadas una operación de secreto oculto, referencia compartida entre plataformas ni transferencia de contraseña directa entre Supabase y Render. GitHub connector tampoco expone una API de Secrets. Usar cualquiera de ellas para pasar la nueva contraseña en texto visible incumpliría la instrucción del propietario.

Por lo tanto:

- No se generó, leyó, transportó ni configuró ninguna contraseña.
- No se alteró el password histórico ni se deshabilitó el rol Core, para no cortar el servicio sin un sucesor verificado.
- La credencial histórica del Core sigue siendo un riesgo pendiente de rotación.
- El escritor permanece NOLOGIN y sin sesiones; el artículo no se insertó.

Intervención mínima cuando el propietario tenga una interfaz segura: generar una contraseña nueva en un gestor de contraseñas y, en un cliente PostgreSQL interactivo conectado como administrador, ejecutar `\password dialektik_core_app` para ingresarla en el prompt oculto; luego actualizar el `DATABASE_URL` del servicio Render desde su Dashboard sin compartir el secreto, conservando host, puerto, base, TLS y CA. No pegar la contraseña en SQL Editor, chat ni logs. Después basta responder que la rotación coordinada terminó; la verificación de conectividad debe ocurrir antes de deshabilitar cualquier credencial anterior. La página de Supabase “Database > Settings” rota la contraseña del rol `postgres`, no sustituye la rotación de `dialektik_core_app`.

## GOV.UK y operación única

- Los endpoints oficiales accesibles desde esta ejecución confirmaron que la página actual del artículo es “Social housing landlord downgraded by RSH”, identifica como fuente al Regulator of Social Housing, muestra fecha 7 de octubre de 2026 y presenta el aviso OGL v3 salvo indicación contraria.
- `robots.txt` de GOV.UK se pudo leer; no contiene una prohibición general de `/api/content` ni de la ruta de este artículo para `User-agent: *`.
- La documentación oficial describe Content API como GET HTTPS por ruta y respuesta JSON estructurada. La petición actual al JSON exacto no llegó a realizarse: el `dry-run` del importador terminó en `GOVUK_RSH_NETWORK_ENOTFOUND`. Eso indica que esta ejecución no resolvió el host; no demuestra que GOV.UK esté caído.
- La revisión de derechos del código está fechada 2026-10-15 y sigue dentro de su ventana configurada de 30 días. La página indica OGL v3, que exige atribución y no cubre contenido excluido o derechos de terceros. El alcance de producto permanece solo metadatos/título, URL canónica, publisher, fechas, atribución y procedencia; no body, excerpt, autor, imágenes, adjuntos ni análisis semántico.
- La documentación en el checkpoint previo reporta un `dry-run` real anterior ese mismo día; esta verificación no lo repite como resultado actual porque el intento actual falló por DNS.
- No se ejecutó `npm run acquire:govuk-rsh --workspace @dialektik/core-api -- --source govuk-rsh --mode persist --once`; no se habilitó LOGIN; no se escribió SQL remoto.
- Nota de seguridad de código: el importador destruye su conexión en `finally`, pero el propio proceso no cambia el rol a NOLOGIN ni finaliza sesiones. Antes de una futura ejecución debe existir un orquestador administrativo independiente que aplique `NOLOGIN`, cierre sesiones y verifique cero conexiones en un `finally`, también si el proceso falla. No se intentó improvisar ese orquestador sin el canal de administración/secretos requerido.

## Flutter, Android, ciencia y costo

- Este checkout no contiene `pubspec.yaml`, APK ni `gradlew`; no es el workspace Flutter. No se ejecutaron pruebas Flutter ni se generó APK.
- El ejecutable ADB no está instalado en esta ejecución. No hay evidencia de un dispositivo físico conectado ni se usó emulador.
- Verificación física del artículo, pantalla, enlace original y autenticación en Android queda `PENDING_OWNER`.
- R14, Gold, Challenge y holdouts no fueron consultados ni modificados. No se activaron las 50 fuentes, polling, Cloudflare, inferencia LIVE ni proveedores pagados.
- Render informa plan Free y Supabase informa organización Free. No se crearon recursos y no se realizaron operaciones facturables. No se consultó el estado de facturación más allá de esos datos de plan.

## Gate para reanudar

No volver a ejecutar migraciones 041/042. No reintentar persistencia hasta que, en este orden, estén verificados: (1) canal seguro de rotación Core y conexión restaurada; (2) `/health/live` y `/health/ready` con HTTP 200; (3) ruta autenticada del piloto verificada sin exponer bearer; (4) respuesta actual del Content API exacto y preflight de derechos/robots; (5) ausencia de registros objetivo; (6) orquestación que garantice NOLOGIN y cero sesiones al terminar aun con error. Luego se puede ejecutar una sola persistencia, consultar recibo/estado ante resultado incierto sin reintentar, y cerrar con Core HTTPS. Android físico sigue siendo un gate separado del propietario.

## Fuentes oficiales consultadas

- GOV.UK artículo: https://www.gov.uk/government/news/social-housing-landlord-downgraded-by-rsh
- GOV.UK robots: https://www.gov.uk/robots.txt
- Documentación GOV.UK Content API: https://content-api.publishing.service.gov.uk/reference.html
- Términos GOV.UK: https://www.gov.uk/help/terms-conditions
- The National Archives, OGL v3: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
- Supabase Postgres roles: https://supabase.com/docs/guides/database/postgres/roles
- Supabase Session pooler endpoint: https://supabase.com/docs/guides/database/connecting-to-postgres#pooler-session-mode
- PostgreSQL 17 password management: https://www.postgresql.org/docs/17/auth-password.html
- PostgreSQL 17 TLS hostname verification: https://www.postgresql.org/docs/17/libpq-connect.html

## Checkpoint de seguimiento — 2026-10-16 19:35 UTC

Este addendum supersede el estado del checkout, los roles y la conectividad descrito arriba; las observaciones anteriores se conservan como historial.

### Estado de proyecto y rotación Core

- Se confirmó otra vez el proyecto `dialektik-dev`, ref `vclsswwfhljczxgnsciq`, región `us-east-1`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11. El ledger sigue en 042 (`20261016074743`); no se aplicó ninguna migración.
- El propietario confirmó desde Connect → Session pooler `aws-0-us-east-1.pooler.supabase.com:5432`. Coincide con el host fijado en el CLI y con el puerto documentado para el pooler de sesión. No se asumió un endpoint regional distinto.
- Se creó `dialektik_core_app_rot_20261016` sin contraseña y `NOLOGIN`, sin atributos administrativos, límite de 5 conexiones, `default_transaction_read_only=on` y `search_path=public`. Su única membresía es `dialektik_core_app` con `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`. No se cambió la contraseña ni el estado LOGIN del rol Core antiguo y no se cambió Render.
- Las comparaciones de privilegios efectivos entre Core y el sucesor dieron cero diferencias en tablas, secuencias, ejecución de funciones y uso/creación del esquema `public`. El sucesor no tiene sesiones. El rol Core antiguo continúa en LOGIN, sin sesiones observadas; GOV.UK writer continúa `NOLOGIN`, sin sesiones.
- La comparación ACL no reemplaza una sesión real. El intento inocuo de `SET ROLE dialektik_core_app_rot_20261016` desde la conexión administrativa fue rechazado por `SET FALSE`, como se configuró. La contraseña del sucesor y la conexión real como sucesor siguen pendientes del propietario.
- Sources, Articles, Events, receipts, versions y exclusions siguen en cero.

### Verificación de endpoint e importador

- Se endureció el contrato del importador para aceptar solo el Session pooler informado, rechazar el host directo, exigir puerto explícito `:5432`, usuario cualificado del proyecto, ruta `/postgres` y ausencia de query/hash. La verificación TLS y hostname ya implementada permanece activa.
- `govuk-product-migration.test.ts`: 7/7 PASS. El primer intento terminó antes de ejecutar tests por `EPERM` al renombrar archivos temporales fuera del workspace; se repitió con un directorio temporal nuevo dentro del checkout y pasó. `npm run build --workspace @dialektik/core-api`: PASS; `git diff --check`: PASS.
- `pg_cron` está disponible en la instancia, pero no instalado; `cron.job` no existe. Por ello no hay supervisor remoto capaz de cerrar el escritor independientemente del proceso. Un `finally` del importador, password expiry o desconexión del proceso no satisface el gate de cierre. La persistencia GOV.UK sigue bloqueada; writer no se habilitó.
- El runbook marca como bloqueadas las instrucciones históricas de habilitación. Próximo diseño seguro: habilitar y verificar por un cambio versionado un supervisor servidor independiente y de tiempo acotado (por ejemplo, tarea one-shot `pg_cron`, primero validada en PG17 desechable), que imponga `NOLOGIN`, termine sesiones y compruebe cero conexiones; probar SIGKILL antes/después del commit y reconciliar el recibo ante respuesta incierta. No instalar extensiones ni programar tareas remotas en este checkpoint.

### Render, Git y próxima intervención

- Render confirma `dialektik-core-dev`, Free, no suspendido, auto-deploy en `codex/v7i-operational-product-pipeline`. La rama `codex/govuk-rsh-one-shot-import` no dispara ese deploy. No se modificaron variables ni se desplegó.
- La prueba HTTP desde este ejecutor volvió a fallar antes de obtener respuesta; `health/live`, `health/ready` y `/live/news` no tienen código HTTP verificable en este intento. El navegador remoto tampoco pudo abrir esos endpoints. El estado `live` de Render no se usa como prueba de salud.
- El cambio del contrato y los informes de seguimiento quedan limitados a esta rama de adquisición; no se incorporó el directorio preexistente sin seguimiento `.task-temp/`.
- Intervención humana mínima para la rotación: usar un cliente `psql` seguro con el CA descargado desde el proyecto y conectarse al Session pooler con `sslmode=verify-full`, usuario admin `postgres.vclsswwfhljczxgnsciq`, host `aws-0-us-east-1.pooler.supabase.com` y puerto `5432`. En el prompt interactivo oculto ejecutar `\password dialektik_core_app_rot_20261016` y luego `ALTER ROLE dialektik_core_app_rot_20261016 LOGIN;`. Cerrar esa sesión y probar una conexión nueva como `dialektik_core_app_rot_20261016.vclsswwfhljczxgnsciq`; ejecutar `SHOW transaction_read_only;` y conteos de `sources`, `articles`, `events`. No incluir contraseñas en URI, SQL Editor, chat, argumentos ni logs. Si la prueba falla, conectarse de nuevo como admin y ejecutar `ALTER ROLE dialektik_core_app_rot_20261016 NOLOGIN;`, sin cambiar Render. Si pasa, cambiar solo `DATABASE_URL` en Render desde su Dashboard para usar el usuario sucesor y la contraseña nueva, preservando host, puerto, base y TLS/CA. Confirmar desde el teléfono que el deploy entrega health 200/200 y lectura autenticada; informar solo estados, y entonces puede cerrarse el Core antiguo desde el canal SQL autorizado.

**Fase 1 sigue BLOCKED** por canal seguro/validación del sucesor, HTTP actual no verificable y falta de supervisor para la futura inserción. No hay artículo real insertado ni E2E Android. R14 y las fuentes candidatas permanecen intactas.
