#!/usr/bin/env bash
# Protected CI only. Isolated PG17 has zero Docker network interfaces.
# Original encrypted archive supplies *roles only*. Synchronized archive
# supplies public/schema+data and all managed data from one MVCC snapshot.
set -euo pipefail
umask 077
db="$1"
work="$2"
test -d "$work/old/clear" && test -d "$work/new/verified" || exit 1
if [ "$(docker inspect "$db" --format '{{json .NetworkSettings.Networks}}')" != '{}' ]; then
  echo 'SYNC_REPLAY_NETWORK_ISOLATION=FAIL'; exit 1
fi
mkdir -p "$work/derived"
phase() {
 label="$1"
 shift
 if "$@" > "$work/derived/$label.private.log" 2>&1; then
   echo "$label=PASS"
 else
   echo "$label=FAIL_REDACTED"
   exit 1
 fi
}
test -s "$work/old/clear/roles.sql" || exit 1
test -s "$work/new/verified/public-full.snapshot.dump" || exit 1
phase PREPARE_SYNC_GLOBAL_ROLES \
  python3 scripts/operations/isolate_parameter_grant.py \
    --source "$work/old/clear/roles.sql" \
    --ordinary-out "$work/derived/roles.ordinary.sql" \
    --privileged-out "$work/derived/roles.parameter-grant.sql"

docker exec -u root "$db" mkdir -p /tmp/dialektik_sync_replay
docker cp "$work/derived/roles.ordinary.sql" "$db:/tmp/dialektik_sync_replay/roles.sql"
docker cp "$work/derived/roles.parameter-grant.sql" "$db:/tmp/dialektik_sync_replay/parameter-grant.sql"
for name in public-full auth-data migration-ledger storage-data realtime-data vault-data; do
  docker cp "$work/new/verified/$name.snapshot.dump" \
    "$db:/tmp/dialektik_sync_replay/$name.dump"
done
docker exec -u root "$db" chown -R postgres:postgres /tmp/dialektik_sync_replay

phase RESTORE_SYNC_COMPATIBLE_ORIGINAL_ROLES \
  docker exec "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_sync_replay/roles.sql
phase RESTORE_SYNC_PARAMETER_GRANT \
  docker exec "$db" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
    -f /tmp/dialektik_sync_replay/parameter-grant.sql

# Source PG dump was already verified to be public-only; no silent table drops.
phase RESTORE_SYNC_PUBLIC_SCHEMA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --schema-only --no-owner --no-privileges --single-transaction --exit-on-error \
    /tmp/dialektik_sync_replay/public-full.dump

# Built-in Auth migrations are preseeded in Supabase local target. Before
# suppressing that one COPY entry, prove all 82 exact archived versions match.
phase EXTRACT_SYNC_AUTH_TOC \
  docker exec "$db" pg_restore --list /tmp/dialektik_sync_replay/auth-data.dump
docker exec "$db" pg_restore --list /tmp/dialektik_sync_replay/auth-data.dump \
  > "$work/derived/auth.toc"
docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT version FROM auth.schema_migrations ORDER BY version;" \
  > "$work/derived/target-auth-versions.txt"
phase PREPARE_SYNC_AUTH_VERSION_EXACT \
  python3 scripts/operations/auth_archive_ledger_gate.py prepare \
    --toc-in "$work/derived/auth.toc" \
    --toc-out "$work/derived/auth-migrations-only.toc"
docker cp "$work/derived/auth-migrations-only.toc" \
  "$db:/tmp/dialektik_sync_replay/auth-migrations-only.toc"
phase EXTRACT_SYNC_AUTH_VERSION_DATA \
  docker exec "$db" pg_restore --data-only \
    --use-list /tmp/dialektik_sync_replay/auth-migrations-only.toc \
    --file /tmp/dialektik_sync_replay/auth-migrations.sql \
    /tmp/dialektik_sync_replay/auth-data.dump
docker cp "$db:/tmp/dialektik_sync_replay/auth-migrations.sql" \
  "$work/derived/auth-migrations.sql"
phase CHECK_SYNC_AUTH_VERSIONS_IDENTICAL \
  python3 scripts/operations/auth_archive_ledger_gate.py compare \
    --archive-sql "$work/derived/auth-migrations.sql" \
    --target-versions "$work/derived/target-auth-versions.txt"
phase FILTER_IDENTICAL_SYNC_AUTH_MIGRATION_COPY \
  python3 scripts/operations/filter_auth_migration_toc.py \
    --toc-in "$work/derived/auth.toc" \
    --toc-out "$work/derived/auth-without-seeded-migrations.toc" \
    --version-sets-confirmed-identical
docker cp "$work/derived/auth-without-seeded-migrations.toc" \
  "$db:/tmp/dialektik_sync_replay/auth-without-seeded-migrations.toc"
phase RESTORE_SYNC_AUTH_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres --data-only \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    --use-list /tmp/dialektik_sync_replay/auth-without-seeded-migrations.toc \
    /tmp/dialektik_sync_replay/auth-data.dump
phase RESTORE_SYNC_APP_LEDGER \
  docker exec "$db" pg_restore -U postgres -d postgres --data-only \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    /tmp/dialektik_sync_replay/migration-ledger.dump
phase RESTORE_SYNC_PUBLIC_DATA \
  docker exec "$db" pg_restore -U postgres -d postgres --data-only \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    /tmp/dialektik_sync_replay/public-full.dump
# Managed schemas are separately restored; any collision stops with no
# arbitrary table exclusion, overwrite, TRUNCATE or ON CONFLICT.
for scope in storage realtime vault; do
  phase "RESTORE_SYNC_MANAGED_$scope" \
    docker exec "$db" pg_restore -U postgres -d postgres --data-only \
      --no-owner --no-privileges --single-transaction --exit-on-error \
      "/tmp/dialektik_sync_replay/$scope-data.dump"
done

# Compare finite original DEV contract, but never print IDs or table values.
case "$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
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
     EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dialektik_govuk_metadata_writer' AND NOT rolcanlogin)
     THEN 'PASS' ELSE 'FAIL' END;" 2>/dev/null)" in
  PASS) echo 'SYNC_RESTORED_AUTH_APP_RELATIONAL_COUNTS=PASS';;
  *) echo 'SYNC_RESTORED_AUTH_APP_RELATIONAL_COUNTS=FAIL_REDACTED'; exit 1;;
esac
bash scripts/operations/verify_restored_roles_rollback.sh "$db" "$work"
bash scripts/operations/networkless_gotrue_replay_smoke.sh "$db" "$work/derived"
echo 'SYNC_RESTORED_GOTRUE_API_FIXTURE=PASS'
echo 'SYNCHRONIZED_ARCHIVE_FULL_NETWORKLESS_RESTORE=PASS'
echo 'GLOBAL_ROLES_FROM_OLD_DIFFERENT_CAPTURE=TRUE'
echo 'REAL_DEV_DATABASE_MUTATIONS=0'
