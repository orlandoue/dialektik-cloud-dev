#!/usr/bin/env bash
# Protected GitHub runner only. Real encrypted Auth data never printed or uploaded.
# 2026-10-21 second owner-authorized protected replay: identify first application data SQL error, no DEV writes.
# Eighth owner-approved replay: verified preserved ciphertext + restored relational invariants.
# DB and all services must be fully offline BEFORE invoking this script.
set -euo pipefail
umask 077
db="$1"
work="$2"
test -n "$db" && test -d "$work" || exit 1
[ "$(docker inspect "$db" --format '{{json .NetworkSettings.Networks}}')" = '{}' ] || {
  echo 'TARGET_CONTAINER_HAS_NETWORK_FAIL_CLOSED'
  exit 1
}
test -s "$work/download/dialektik-complete-dev-20261020.tar.gpg" || exit 1

phase() {
  label="$1"
  shift
  if "$@" > "$work/derived/$label.log" 2>&1; then
    echo "$label=PASS"
  else
    echo "$label=FAIL_REDACTED"
    case "$label" in
      RESTORE_APPLICATION_ROLES|RESTORE_PRIVILEGED_PARAMETER_GRANT|RESTORE_APPLICATION_SCHEMA|RESTORE_MANAGED_AUTH_DATA|RESTORE_MIGRATION_LEDGER_DATA|RESTORE_APPLICATION_DATA)
        python3 scripts/operations/classify_private_restore_error.py \
          --private-log "$work/derived/$label.log"
        if [ "$label" = "RESTORE_APPLICATION_DATA" ]; then
          python3 scripts/operations/classify_private_restore_error.py \
            --private-log "$work/derived/$label.log" --first-error-only
          # Fixed classification only; never emit SQL, relation names or rows.
          python3 scripts/operations/app_data_copy_scope.py \
            --private-log "$work/derived/$label.log" \
            --data-sql "$work/derived/data.safe.sql"
        fi ;;
    esac
    exit 1
  fi
}
# This script only receives the passphrase in BACKUP_PASSWORD via a protected
# single GitHub step; do not print it, export it, or persist it as an artifact.
test -n "${BACKUP_PASSWORD:-}" || { echo 'PROTECTED_PASSPHRASE_NOT_PRESENT'; exit 1; }
printf '%s' "$BACKUP_PASSWORD" > "$work/derived/key"
phase DECRYPT_REAL_CIPHERTEXT \
  gpg --quiet --batch --no-tty --pinentry-mode loopback \
    --passphrase-file "$work/derived/key" --decrypt \
    --output "$work/derived/backup.tar" \
    "$work/download/dialektik-complete-dev-20261020.tar.gpg"
rm -f "$work/derived/key"
unset BACKUP_PASSWORD

python3 scripts/operations/verify_real_restore_bundle.py verify \
  --tar "$work/derived/backup.tar" --dest "$work/clear"
for part in roles schema data; do
  python3 scripts/operations/verify_real_restore_bundle.py sanitize \
    --input "$work/clear/$part.sql" --output "$work/derived/$part.safe.sql"
done
# The target synthetic PG17 proof showed postgres is non-superuser while the
# built-in supabase_admin CAN replay this exact source parameter GRANT.
# Preserve every privilege from source: split the single GRANT rather than
# discarding it, and do NOT permit any other source SQL mutation.
cmp -s "$work/clear/roles.sql" "$work/derived/roles.safe.sql" || {
  echo 'SOURCE_ROLE_SQL_SANITIZER_CHANGED_UNEXPECTED_CONTENT_ABORT'
  exit 1
}
python3 scripts/operations/isolate_parameter_grant.py \
  --source "$work/clear/roles.sql" \
  --ordinary-out "$work/derived/roles.ordinary.sql" \
  --privileged-out "$work/derived/roles.parameter-grant.sql"

# Copies of authenticated encrypted-source files exist only in this runner and
# this networkless container. No SQL content or user IDs leave either process.
docker exec -u root "$db" mkdir -p /tmp/dialektik_restore_real
docker cp "$work/clear/managed-auth.dump" "$db:/tmp/dialektik_restore_real/auth.dump"
docker cp "$work/clear/managed-ledger.dump" "$db:/tmp/dialektik_restore_real/ledger.dump"
docker cp "$work/derived/roles.ordinary.sql" "$db:/tmp/dialektik_restore_real/roles.sql"
docker cp "$work/derived/roles.parameter-grant.sql" "$db:/tmp/dialektik_restore_real/parameter-grant.sql"
for part in schema data; do
  docker cp "$work/derived/$part.safe.sql" "$db:/tmp/dialektik_restore_real/$part.sql"
done
docker exec -u root "$db" chown -R postgres:postgres /tmp/dialektik_restore_real
phase BUILD_MANAGED_ARCHIVE_TOC \
  docker exec "$db" pg_restore --list /tmp/dialektik_restore_real/auth.dump
phase BUILD_MIGRATION_LEDGER_TOC \
  docker exec "$db" pg_restore --list /tmp/dialektik_restore_real/ledger.dump
# Rebuild TOC as private files for structural comparison. No source records read.
docker exec "$db" pg_restore --list /tmp/dialektik_restore_real/auth.dump > "$work/derived/auth.toc"
docker exec "$db" pg_restore --list /tmp/dialektik_restore_real/ledger.dump > "$work/derived/ledger.toc"
docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT tablename FROM pg_tables WHERE schemaname='auth';" \
  > "$work/derived/target-auth.txt"
docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT tablename FROM pg_tables WHERE schemaname='supabase_migrations';" \
  > "$work/derived/target-ledger.txt"
python3 scripts/operations/check_local_restore_target.py \
  --auth-toc "$work/derived/auth.toc" --ledger-toc "$work/derived/ledger.toc" \
  --target-auth "$work/derived/target-auth.txt" \
  --target-ledger "$work/derived/target-ledger.txt"

# No silent force, table skips or merges: mismatch must fail.
phase RESTORE_APPLICATION_ROLES \
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_restore_real/roles.sql
phase RESTORE_PRIVILEGED_PARAMETER_GRANT \
  docker exec "$db" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_restore_real/parameter-grant.sql
echo 'SOURCE_PARAMETER_PRIVILEGE_PRESERVED_IN_ISOLATED_TARGET=PASS'
phase RESTORE_APPLICATION_SCHEMA \
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_restore_real/schema.sql
# The initialized offline Auth target already contains 82 internal versions.
# Extract *only* the archived migration table via a derived pg_restore TOC.
# No source Auth user/session rows are restored or filtered in this preflight.
python3 scripts/operations/auth_archive_ledger_gate.py prepare \
  --toc-in "$work/derived/auth.toc" \
  --toc-out "$work/derived/auth-archive-only-migrations.toc"
docker cp "$work/derived/auth-archive-only-migrations.toc" \
  "$db:/tmp/dialektik_restore_real/auth-archive-only-migrations.toc"
phase EXTRACT_AUTH_ARCHIVE_MIGRATION_DATA \
  docker exec "$db" pg_restore --data-only \
    --use-list /tmp/dialektik_restore_real/auth-archive-only-migrations.toc \
    --file /tmp/dialektik_restore_real/auth-archive-versions.sql \
    /tmp/dialektik_restore_real/auth.dump
docker cp "$db:/tmp/dialektik_restore_real/auth-archive-versions.sql" \
  "$work/derived/auth-archive-versions.sql"
docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM auth.schema_migrations ORDER BY version;" \
  > "$work/derived/auth-local-seeded-versions.txt"
chmod 0600 "$work/derived/auth-archive-versions.sql" \
  "$work/derived/auth-local-seeded-versions.txt"
# Fail closed if ANY of the archived 82 versions differs from the 82 seeded local
# versions. A live-source equality proof is NOT an acceptable substitute.
phase CHECK_AUTH_ARCHIVE_VERSION_EQUALITY \
  python3 scripts/operations/auth_archive_ledger_gate.py compare \
    --archive-sql "$work/derived/auth-archive-versions.sql" \
    --target-versions "$work/derived/auth-local-seeded-versions.txt"
echo 'ORIGINAL_ARCHIVE_VERSUS_ISOLATED_AUTH_82_VERSIONS=IDENTICAL'
# Only now derive an approved TOC that removes exactly one seeded ledger table.
# This retains all other 26 Auth TABLE DATA entries, including users and sessions.
python3 scripts/operations/filter_auth_migration_toc.py \
  --toc-in "$work/derived/auth.toc" \
  --toc-out "$work/derived/auth-exclude-identical-migration-ledger.toc" \
  --version-sets-confirmed-identical
docker cp "$work/derived/auth-exclude-identical-migration-ledger.toc" \
  "$db:/tmp/dialektik_restore_real/auth-exclude-identical-migration-ledger.toc"
phase RESTORE_MANAGED_AUTH_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --data-only --single-transaction --exit-on-error \
    --use-list /tmp/dialektik_restore_real/auth-exclude-identical-migration-ledger.toc \
    /tmp/dialektik_restore_real/auth.dump
phase RESTORE_MIGRATION_LEDGER_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --data-only --single-transaction --exit-on-error \
    /tmp/dialektik_restore_real/ledger.dump
# The verified managed Auth custom archive was restored above.
# A general dump may duplicate Auth COPY rows: compare every Auth COPY from that
# general dump against the original independent managed archive first.
# Fail closed on ANY row, column, table-coverage or sequence mismatch.
phase EXTRACT_ARCHIVED_AUTH_DATA_FOR_EQUALITY \
  docker exec "$db" pg_restore --data-only \
    --file /tmp/dialektik_restore_real/auth-original-compare.sql \
    /tmp/dialektik_restore_real/auth.dump
docker cp "$db:/tmp/dialektik_restore_real/auth-original-compare.sql" \
  "$work/derived/auth-original-compare.sql"
python3 scripts/operations/auth_data_copy_equivalence.py \
  --general-data "$work/derived/data.safe.sql" \
  --archive-data "$work/derived/auth-original-compare.sql" \
  --out "$work/derived/data.auth-reconciled.sql"
docker cp "$work/derived/data.auth-reconciled.sql" \
  "$db:/tmp/dialektik_restore_real/data.auth-reconciled.sql"
docker exec -u root "$db" chown postgres:postgres \
  /tmp/dialektik_restore_real/data.auth-reconciled.sql
echo 'AUTH_DUPLICATE_SOURCE_COPY_BLOCKS_EXACTLY_RECONCILED=PASS'
# Application data is separately atomic in the disposable target. A failure
# rolls back all rows from this stage, preserving Auth + ledger for investigation.
# Only the FIRST SQL ERROR class is released as a fixed allowlisted marker.
phase RESTORE_APPLICATION_DATA \
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    --single-transaction \
    -f /tmp/dialektik_restore_real/data.auth-reconciled.sql

count="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM supabase_migrations.schema_migrations);" | tr '|' ':')"
if [ "$count" != "1:50" ]; then
  echo 'REAL_AUTH_AND_LEDGER_COUNT_MISMATCH_NO_GO'
  exit 1
fi
echo 'REAL_AUTH_AND_LEDGER_COUNT_REPLAY=PASS'
has_rls="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.articles')),false);")"
[ "$has_rls" = 't' ] || { echo 'PUBLIC_ARTICLES_RLS_NOT_RESTORED'; exit 1; }
echo 'REAL_PUBLIC_ARTICLES_RLS=PASS'
# Fixed snapshot contract, independently observed on remote DEV read-only:
# one Auth user, one matching authorized private-beta identity, seven categories,
# no source/articles/events/live records and writer NOLOGIN.
# Query results (including identities) are never printed to GitHub logs.
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT CASE WHEN
    (SELECT count(*) FROM auth.users)=1 AND
    (SELECT count(*) FROM public.private_beta_testers)=1 AND
    (SELECT count(*) FROM public.private_beta_testers b JOIN auth.users u ON u.id=b.user_id)=1 AND
    (SELECT count(*) FROM public.categories)=7 AND
    (SELECT count(*) FROM public.sources)=0 AND
    (SELECT count(*) FROM public.articles)=0 AND
    (SELECT count(*) FROM public.events)=0 AND
    (SELECT count(*) FROM public.live_acquisition_receipts)=0 AND
    (SELECT count(*) FROM public.live_article_versions)=0 AND
    (SELECT max(version) FROM supabase_migrations.schema_migrations)='20261016074743' AND
    EXISTS (SELECT 1 FROM pg_roles
            WHERE rolname='dialektik_govuk_metadata_writer' AND NOT rolcanlogin)
    THEN 'PASS' ELSE 'FAIL' END;" \
  > "$work/derived/restored-relational-integrity.log" 2>&1; then
  echo 'REAL_AUTH_APP_RELATIONAL_INTEGRITY=FAIL_REDACTED'
  exit 1
fi
if [ "$(cat "$work/derived/restored-relational-integrity.log")" != "PASS" ]; then
  echo 'REAL_AUTH_APP_RELATIONAL_INTEGRITY=FAIL_REDACTED'
  exit 1
fi
echo 'REAL_AUTH_APP_RELATIONAL_INTEGRITY=PASS'
echo 'AUTH_APP_TESTER_LINKS=PASS'
echo 'RESTORED_GOVUK_WRITER_STILL_NOLOGIN=PASS'

# Validate the restored Core and disabled writer ACL/RLS, then intentionally
# fail a transaction containing a synthetic table and row; prove rollback.
bash scripts/operations/verify_restored_roles_rollback.sh "$db" "$work"
echo 'REAL_BACKUP_OFFLINE_DATABASE_REPLAY=PASS'
echo 'AUTH_API_LOGIN_VERIFICATION=NOT_EXECUTED'
echo 'DATABASE_BACKUP_ATOMICITY=NOT_ESTABLISHED'
echo 'PRODUCTION_RESTORE_GATE=STILL_PENDING_SEPARATE_APPROVAL'
