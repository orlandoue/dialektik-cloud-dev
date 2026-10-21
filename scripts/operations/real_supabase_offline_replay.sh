#!/usr/bin/env bash
# Protected GitHub runner only. Real encrypted Auth data never printed or uploaded.
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
    if [ "$label" = 'RESTORE_APPLICATION_ROLES' ]; then
      python3 scripts/operations/classify_private_restore_error.py \
        --private-log "$work/derived/$label.log"
    fi
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
phase RESTORE_MANAGED_AUTH_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --data-only --single-transaction --exit-on-error \
    /tmp/dialektik_restore_real/auth.dump
phase RESTORE_MIGRATION_LEDGER_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --data-only --single-transaction --exit-on-error \
    /tmp/dialektik_restore_real/ledger.dump
phase RESTORE_APPLICATION_DATA \
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_restore_real/data.sql

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
echo 'REAL_BACKUP_OFFLINE_DATABASE_REPLAY=PASS'
echo 'AUTH_API_LOGIN_VERIFICATION=NOT_EXECUTED'
echo 'DATABASE_BACKUP_ATOMICITY=NOT_ESTABLISHED'
echo 'PRODUCTION_RESTORE_GATE=STILL_PENDING_SEPARATE_APPROVAL'
