# DIALEKTIK — aprobación explícita de restauración aislada

Estado: **BLOQUEADO — NO EJECUTAR hasta disponer de un destino Supabase con Auth y ledger inicializados y workflow corregido**.

**Advertencia:** la prueba [39494466690](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39494466690) demostró que arrancar la imagen PostgreSQL 17.11 por sí sola deja sin crear `auth.identities`, `auth.sessions` y `supabase_migrations.schema_migrations`. El workflow protegido actual apunta a ese contenedor incompleto y su ejecución produciría una restauración fallida. Las siguientes instrucciones de autorización quedan SUSPENDIDAS hasta completar la inicialización real de destino.

Esta marca permite solicitar, con un commit manual desde GitHub, una ejecución de
`.github/workflows/real-backup-isolated-restore.yml` sobre el respaldo cifrado
ya existente. La ejecución usa únicamente el entorno protegido
`dialektik-dev-backup` y un contenedor PostgreSQL efímero **sin conexión de red**.

**No** escribe en Supabase DEV, **no** ejecuta migraciones 043/044, **no** activa
un usuario de PostgreSQL, **no** despliega Core/Render/Flutter. El respaldo
descifrado no se publica como artefacto y se borra del runner al terminar.

## Para solicitar la ejecución desde GitHub

El propietario comprueba el workflow y, en esta rama exacta,
abre `.github/workflows/real-backup-isolated-restore.yml`. Añade
**únicamente un comentario** de aprobación justo debajo de `name:`,
por ejemplo `# OWNER_APPROVED_OFFLINE_RESTORE_20261020`. No altera los
comandos, condiciones ni permisos. Al confirmar el cambio al workflow
(que sí está incluido en el filtro de archivos del evento `push`),
utiliza el **mensaje exacto de commit**:

`EXECUTE_ISOLATED_ENCRYPTED_RESTORE_20261020`

De este modo la autorización corresponde a un commit explícito del propietario
y la protección del Environment sigue activa. Las ejecuciones ordinarias no
descifran el archivo.

Después se verifica el run de GitHub Actions. Un PASS parcial en integridad
no equivale a un PASS de RESTORE-GATE: el éxito de restauración Auth, ledger,
esquema, permisos, RLS y prueba real de Core deberá acreditarse por separado.

El respaldo cifrado del run `39488529000`, artefacto `12295491516`,
vence el **2026-10-27T20:20:08Z**. El propietario debe conservar una copia
cifrada fuera de GitHub, junto con la custodia privada de la passphrase.
