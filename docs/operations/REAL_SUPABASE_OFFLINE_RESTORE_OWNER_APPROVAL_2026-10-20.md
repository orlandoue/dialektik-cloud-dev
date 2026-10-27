# DIALEKTIK — aprobación protegida de restauración REAL a Supabase local descartable

**Fecha:** 2026-10-20

## Estado verificado ANTES de la autorización

- [Respaldo auténtico cifrado, PASS, run 39488529000](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39488529000): 27 tablas Auth, un archivo de datos para `supabase_migrations.schema_migrations`, aplicación y roles. Artefacto ciphertext `12295491516` vence **2026-10-27T20:20:08Z**.
- [Cotejo de checksum/inventario sintético, PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39493588874): 12 pruebas + restore PostgreSQL sintético.
- [Supabase local con Auth y ledger completo, PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39496310757): **27 tablas Auth** en el destino, todas las cuatro tablas críticas y el ledger presentes. No prueba aún que los 27 nombres/columnas coincidan con el respaldo.
- [Script protegido Bash/Python, PASS](https://github.com/orlandoue/dialektik-cloud-dev/actions/runs/39496815295): 12 tests + parser shell/Python, sin usar datos reales.
- **Ejecuciones protegidas reales sobre ese destino:** 0. El respaldo auténtico aún NO ha sido restaurado; `RESTORE-GATE #4` permanece OPEN.

## Qué ejecutaría este workflow

Archivo revisable:
[.github/workflows/real-backup-local-supabase-restore.yml](https://github.com/orlandoue/dialektik-cloud-dev/blob/codex/restore-gate-managed-recovery-20261020/.github/workflows/real-backup-local-supabase-restore.yml).

1. Inicializa solo una instancia Supabase local descartable; reconstruye el ledger vacío de seis columnas. Sin credenciales de la base remota.
2. Detiene los servicios locales no-DB y desconecta **todas** las interfaces de red del contenedor PostgreSQL; valida desconexión.
3. Descarga **solamente** el artefacto cifrado `12295491516` bajo token GitHub de lectura y descifra con la passphrase del **Environment protegido** en el runner efímero. No emite filas, emails, UUID ni SQL en logs.
4. Autentica cada archivo de origen mediante SHA-256; compara todos los nombres de tablas Auth del backup contra el catálogo destino **antes de importar datos**.
5. Intenta las restauraciones de roles, esquema, datos Auth, ledger y datos del producto en ese orden. No omite errores, no usa `CASCADE` sobre tablas Auth y no inventa columnas.
6. Requiere reproducir `auth.users=1`, ledger=50 y RLS en `public.articles`; el resultado puede ser FAIL si aparecen incompatibilidades.
7. Destruye contenedores y plaintext al finalizar, incluso en FAIL. No envía los datos a otros servicios ni cambia Supabase DEV, Render o Flutter.

**Límite:** incluso con un PASS del DB replay, todavía falta demostrar compatibilidad de sesión/login GoTrue/Core, políticas/ACL integrales, rollback y consistencia temporal de varias capturas para cerrar RESTORE-GATE #4.

## Autorización manual y explícita del propietario

El workflow **NO SE EJECUTA** por pushes ordinarios ni desde `workflow_dispatch`. Si estás conforme con el código y la retención temporal de datos en el runner, autoriza personalmente:

1. Ve a la rama `codex/restore-gate-managed-recovery-20261020`.
2. Abre el archivo [real-backup-local-supabase-restore.yml](https://github.com/orlandoue/dialektik-cloud-dev/blob/codex/restore-gate-managed-recovery-20261020/.github/workflows/real-backup-local-supabase-restore.yml).
3. Edita **solamente un comentario** al comienzo del YAML (sin cambiar permisos ni instrucciones), por ejemplo agrega `# OWNER_APPROVED_PROTECTED_REAL_LOCAL_RESTORE` debajo de `name:`.
4. Guarda **directamente en la misma rama** con este mensaje de commit EXACTO:
   `APPROVE_REAL_SUPABASE_OFFLINE_RESTORE_20261020`.
5. Revisa **Actions → Dialektik complete Supabase Auth offline replay (protected, opt-in)** y espera el resultado. Conserva URL/run ID y comparte solo ese ID, no archivos de Auth ni secretos.

**No pulses merge del PR #10 ni uses SQL remoto para autorizar esta prueba.** Esta aprobación no modifica la base activa. La rama está permitida en `Settings → Environments → dialektik-dev-backup`.

## Si falla

Un FAIL representa un hallazgo de compatibilidad, no permiso para ignorar errores ni reintentar a ciegas. Registrar etapa fallida y reconstruir destino, verificar columnas y versiones; corregir en un candidato nuevo y validar fuera de la base DEV antes de volver a solicitar aprobación.

**Protección del respaldo:** descarga y conserva fuera de GitHub una copia cifrada del artefacto `12295491516` antes de que venza. No compartas la passphrase.
