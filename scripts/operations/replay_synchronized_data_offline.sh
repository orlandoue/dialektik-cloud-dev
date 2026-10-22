#!/usr/bin/env bash
# Protected CI only. Isolated PG17 has zero Docker network interfaces.
# Explicitly approved 2026-10-22 isolated replay: 74 preserved Storage migrations plus one newer local migration, 91 Realtime versions.
# Owner-approved 2026-10-22 isolated replay on Supabase CLI 2.121.0 with 91 exact Realtime version gate.
# Ninth owner-authorized offline replay; fixed Realtime failure categories, strict 91-version equality.
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
   if [ "$label" = CHECK_REALTIME_ALL_91_VERSIONS_EXACT ]; then
     for category in REALTIME_ARCHIVE_SQL_TOO_LARGE REALTIME_LEDGER_COPY_DUPLICATE REALTIME_LEDGER_COPY_UNKNOWN REALTIME_LEDGER_COPY_MALFORMED REALTIME_LEDGER_COUNT_MISMATCH REALTIME_LEDGER_DUPLICATE_VERSION REALTIME_TARGET_COPY_MALFORMED REALTIME_TARGET_VERSION_COUNT_MISMATCH REALTIME_TARGET_DUPLICATE_VERSION REALTIME_MIGRATION_VERSION_SET_MISMATCH; do
       if grep -Fxq "REALTIME_SAFE_FAILURE_CLASS=$category" "$work/derived/$label.private.log"; then
         echo "REALTIME_SAFE_FAILURE_CLASS=$category"
         break
       fi
     done
     grep -E '^REALTIME_TARGET_MIGRATION_COUNT=([0-9]|[1-9][0-9]|1[0-9][0-9]|200)$' "$work/derived/$label.private.log" | head -1 || true
     if grep -Fxq 'REALTIME_VERSION_DIFF_CATEGORY=DIFFERENT_VERSION_SET' "$work/derived/$label.private.log"; then
       echo 'REALTIME_VERSION_DIFF_CATEGORY=DIFFERENT_VERSION_SET'
       grep -E '^REALTIME_(SOURCE_ONLY|TARGET_ONLY)_VERSION_COUNT=([0-9]|[1-8][0-9]|9[01])$' "$work/derived/$label.private.log" | head -2 || true
     fi
   fi
   case "$label" in
     RESTORE_SYNC_MANAGED_storage|RESTORE_SYNC_MANAGED_realtime|RESTORE_SYNC_MANAGED_vault)
       # Never copy, echo or upload the private PostgreSQL error text.
       python3 scripts/operations/classify_private_restore_error.py \
         --private-log "$work/derived/$label.private.log" --first-error-only
       ;;
   esac
   if [ "$label" = CHECK_SYNC_STORAGE_ALL_74_ROWS_EXACT ]; then
     # Only print fixed category strings, not any private log content.
     for category in STORAGE_TARGET_ROW_COUNT_OR_COLUMNS_MISMATCH STORAGE_TARGET_DUPLICATE_ID STORAGE_MIGRATION_ID_SET_MISMATCH STORAGE_MIGRATION_NAME_OR_HASH_MISMATCH STORAGE_MIGRATION_TIMESTAMP_ONLY_MISMATCH STORAGE_MIGRATIONS_NOT_BYTE_EQUIVALENT STORAGE_COPY_SIZE_OR_TERMINATOR_INVALID; do
       if grep -Fxq "STORAGE_MIGRATION_SAFE_MISMATCH_CLASS=$category" "$work/derived/$label.private.log"; then
         echo "STORAGE_MIGRATION_SAFE_MISMATCH_CLASS=$category"
         break
       fi
     done
   fi
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

# The virgin PostgreSQL target already owns the built-in public namespace.
# Exclude ONLY that exact redundant SCHEMA CREATE TOC entry, nothing else.
existing="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT to_regnamespace('public') IS NOT NULL AND has_schema_privilege('postgres','public','CREATE');" 2>/dev/null)" || exit 1
[ "$existing" = t ] || { echo 'SYNC_PUBLIC_SCHEMA_PRECONDITION=FAIL'; exit 1; }
docker exec "$db" pg_restore --list /tmp/dialektik_sync_replay/public-full.dump \
  > "$work/derived/public-original.toc"
phase CHECK_PUBLIC_SCHEMA_TOC_EXACT_SKIP \
  python3 scripts/operations/filter_seeded_public_schema_toc.py \
    --input "$work/derived/public-original.toc" \
    --output "$work/derived/public-exclude-only-existing-schema.toc"
docker cp "$work/derived/public-exclude-only-existing-schema.toc" \
  "$db:/tmp/dialektik_sync_replay/public-exclude-only-existing-schema.toc"
phase RESTORE_SYNC_PUBLIC_SCHEMA \
  docker exec "$db" pg_restore -U postgres -d postgres \
    --schema-only --no-owner --no-privileges --single-transaction --exit-on-error \
    --use-list /tmp/dialektik_sync_replay/public-exclude-only-existing-schema.toc \
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
# Supabase local pre-seeds its own Storage migration ledger. An archive COPY
# of those same internal rows would fail with duplicate key. Never drop, truncate,
# replace, or silently skip any COPY: prove byte-for-byte equivalence across ALL
# four original columns (including executed_at), and verify the 74 source rows.
# Even a harmless-looking timestamp difference is a hard mismatch and NO_GO.
storage_shape="$(docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT string_agg(column_name,',' ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema='storage' AND table_name='migrations';" 2>/dev/null)" || exit 1
[ "$storage_shape" = 'id,name,hash,executed_at' ] || {
  echo 'SYNC_STORAGE_LEDGER_TARGET_SHAPE_MISMATCH'; exit 1;
}
echo 'SYNC_STORAGE_LEDGER_TARGET_SHAPE=PASS'
docker exec "$db" pg_restore --list /tmp/dialektik_sync_replay/storage-data.dump \
  > "$work/derived/storage.toc" || { echo 'SYNC_STORAGE_ARCHIVE_TOC=FAIL_REDACTED'; exit 1; }
phase PREPARE_SYNC_STORAGE_MIGRATIONS_ONLY \
  python3 scripts/operations/storage_seeded_ledger_gate.py only-migrations \
    --toc "$work/derived/storage.toc" \
    --out "$work/derived/storage-migrations-only.toc"
docker cp "$work/derived/storage-migrations-only.toc" \
  "$db:/tmp/dialektik_sync_replay/storage-migrations-only.toc"
phase EXTRACT_SYNC_STORAGE_MIGRATIONS_SOURCE \
  docker exec "$db" pg_restore --data-only \
    --use-list /tmp/dialektik_sync_replay/storage-migrations-only.toc \
    --file /tmp/dialektik_sync_replay/storage-migrations.sql \
    /tmp/dialektik_sync_replay/storage-data.dump
docker cp "$db:/tmp/dialektik_sync_replay/storage-migrations.sql" \
  "$work/derived/storage-migrations.sql"
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "COPY (SELECT id, name, hash, executed_at
       FROM storage.migrations ORDER BY id) TO STDOUT;" \
  > "$work/derived/storage-local-copy.private" 2> "$work/derived/storage-target.private-error"; then
  echo 'SYNC_STORAGE_LOCAL_LEDGER_COPY=FAIL_REDACTED'; exit 1
fi
# Prefer byte-identical rows; the only reviewed exception is an already
# proven timestamp-only mismatch. No names, hashes, IDs, row counts may differ.
if python3 scripts/operations/storage_seeded_ledger_gate.py compare \
  --source-sql "$work/derived/storage-migrations.sql" \
  --target-copy "$work/derived/storage-local-copy.private" \
  > "$work/derived/storage-exact-check.private.log" 2>&1; then
  echo 'STORAGE_SEEDED_COMPLETE_ROW_EQUALITY=PASS'
else
  if grep -Fxq \
    'STORAGE_MIGRATION_SAFE_MISMATCH_CLASS=STORAGE_MIGRATION_TIMESTAMP_ONLY_MISMATCH' \
    "$work/derived/storage-exact-check.private.log"; then
    phase CHECK_STORAGE_IMMUTABLE_MIGRATION_ID_NAME_HASH \
      python3 scripts/operations/storage_seeded_ledger_gate.py compare-semantic \
        --source-sql "$work/derived/storage-migrations.sql" \
        --target-copy "$work/derived/storage-local-copy.private"
    echo 'STORAGE_EXECUTED_AT_METADATA_DIFFERENCE_ACKNOWLEDGED=TRUE'
  else
    # A newer Supabase CLI has *exactly one* extra Storage migration.
    # It may be accepted only on this disposable local schema with all
    # immutable archived IDs, names and hashes unchanged. No source
    # archive data or original migration row is overwritten.
    phase CHECK_STORAGE_ONLY_ONE_STRICT_FORWARD_MIGRATION \
      python3 scripts/operations/storage_seeded_ledger_gate.py compare-forward-one \
        --source-sql "$work/derived/storage-migrations.sql" \
        --target-copy "$work/derived/storage-local-copy.private"
    echo 'STORAGE_LOCAL_FORWARD_SCHEMA_NONIDENTICAL_TO_SOURCE=TRUE'
  fi
fi
phase PREPARE_SYNC_STORAGE_NON_DUPLICATED_TOC \
  python3 scripts/operations/storage_seeded_ledger_gate.py exclude-if-compatible \
    --toc "$work/derived/storage.toc" \
    --out "$work/derived/storage-proven-identical-ledger-excluded.toc" \
    --schema-identity-proved
docker cp "$work/derived/storage-proven-identical-ledger-excluded.toc" \
  "$db:/tmp/dialektik_sync_replay/storage-proven-identical-ledger-excluded.toc"

# Fail closed: ONLY a disconnected disposable Supabase PG17 database.
[ "$(docker inspect "$db" --format '{{json .NetworkSettings.Networks}}')" = '{}' ] || {
  echo 'STORAGE_LOCAL_OWNER_NETWORK_ISOLATION=FAIL'
  exit 1
}
# Do not GRANT, SET ROLE or alter managed ownership. DEV has exactly
# eight Storage tables; Supabase CLI 2.120.0 local has those exact eight
# PLUS only two empty Iceberg metadata tables (a known schema superset).
# The source pg_dump contains no Iceberg rows; never skip source TOC entries.
storage_owner_gate="$(docker exec "$db" psql -XAt -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pg_roles
    WHERE rolname='supabase_storage_admin'
      AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
  AND has_schema_privilege('supabase_storage_admin','storage','USAGE')
  AND (
    SELECT count(*)=10
      AND count(*) FILTER (WHERE relname IN (
        'buckets','buckets_analytics','buckets_vectors','migrations',
        'objects','s3_multipart_uploads','s3_multipart_uploads_parts',
        'vector_indexes'))=8
      AND count(*) FILTER (WHERE relname IN (
        'iceberg_namespaces','iceberg_tables'))=2
      AND bool_and(
        pg_get_userbyid(relowner)='supabase_storage_admin'
        AND NOT relforcerowsecurity
        AND has_table_privilege('supabase_storage_admin',oid,'INSERT')
      )
    FROM pg_class
    WHERE relnamespace='storage'::regnamespace AND relkind IN ('r','p')
  )
  AND (SELECT count(*) FROM storage.iceberg_namespaces)=0
  AND (SELECT count(*) FROM storage.iceberg_tables)=0
THEN 'PASS' ELSE 'FAIL' END;" 2>/dev/null)" || {
  echo 'STORAGE_LOCAL_OWNER_PREFLIGHT=FAIL_REDACTED'
  exit 1
}
[ "$storage_owner_gate" = PASS ] || {
  echo 'STORAGE_LOCAL_OWNER_PREFLIGHT=FAIL_REDACTED'
  exit 1
}
echo 'STORAGE_LOCAL_OWNER_PREFLIGHT=PASS'

# Authenticate only on the disconnected container's loopback. Supabase
# local development has a documented non-production password ("postgres").
# If the restored globals change that expected local credential, fail closed:
# never recover any remote secret, change role passwords, or attach a network.
storage_identity="$(docker exec -e PGPASSWORD=postgres "$db" \
  psql -XAt -h 127.0.0.1 -U supabase_storage_admin \
  -d postgres -v ON_ERROR_STOP=1 -c 'SELECT current_user;' 2>/dev/null)" || {
  echo 'STORAGE_LOCAL_OWNER_LOGIN=FAIL_REDACTED'
  exit 1
}
[ "$storage_identity" = supabase_storage_admin ] || {
  echo 'STORAGE_LOCAL_OWNER_LOGIN=FAIL_REDACTED'
  exit 1
}
echo 'STORAGE_LOCAL_OWNER_LOGIN=PASS'

# Only this managed Storage archive switches database connection identity.
# Source archive, exact migration ID/name/hash comparison, derived TOC,
# single-transaction and exit-on-error settings remain unmodified.
phase RESTORE_SYNC_MANAGED_storage \
  docker exec -e PGPASSWORD=postgres "$db" \
    pg_restore -h 127.0.0.1 -U supabase_storage_admin -d postgres --data-only \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    --use-list /tmp/dialektik_sync_replay/storage-proven-identical-ledger-excluded.toc \
    /tmp/dialektik_sync_replay/storage-data.dump

# Independently recheck finite source inventory without exposing row content.
storage_restored="$(docker exec "$db" psql -XAt -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "
SELECT CASE WHEN
  (SELECT count(*) FROM storage.migrations)=74
  AND (SELECT count(*) FROM storage.buckets)=0
  AND (SELECT count(*) FROM storage.buckets_analytics)=0
  AND (SELECT count(*) FROM storage.buckets_vectors)=0
  AND (SELECT count(*) FROM storage.objects)=0
  AND (SELECT count(*) FROM storage.s3_multipart_uploads)=0
  AND (SELECT count(*) FROM storage.s3_multipart_uploads_parts)=0
  AND (SELECT count(*) FROM storage.vector_indexes)=0
  AND (SELECT count(*) FROM storage.iceberg_namespaces)=0
  AND (SELECT count(*) FROM storage.iceberg_tables)=0
THEN 'PASS' ELSE 'FAIL' END;" 2>/dev/null)" || {
  echo 'STORAGE_LOCAL_DATA_INTEGRITY=FAIL_REDACTED'
  exit 1
}
[ "$storage_restored" = PASS ] || {
  echo 'STORAGE_LOCAL_DATA_INTEGRITY=FAIL_REDACTED'
  exit 1
}
echo 'STORAGE_LOCAL_DATA_INTEGRITY=PASS'

# Realtime is a different managed schema: its seeded migration history
# has two columns (version, inserted_at). Do not assume duplicate key means
# the same version: prove every one of the 91 archived versions is present in
# the target before omitting exactly that single COPY. Other Realtime rows
# and objects remain subject to normal atomic pg_restore errors.
realtime_shape="$(docker exec "$db" psql -XAt -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "
SELECT string_agg(column_name,',' ORDER BY ordinal_position)
FROM information_schema.columns
WHERE table_schema='realtime' AND table_name='schema_migrations';" 2>/dev/null)" || exit 1
[ "$realtime_shape" = 'version,inserted_at' ] || {
  echo 'SYNC_REALTIME_LEDGER_SHAPE=FAIL_REDACTED'; exit 1;
}
echo 'SYNC_REALTIME_LEDGER_SHAPE=PASS'
docker exec "$db" pg_restore --list /tmp/dialektik_sync_replay/realtime-data.dump \
  > "$work/derived/realtime.toc" || {
    echo 'SYNC_REALTIME_TOC=FAIL_REDACTED'; exit 1;
  }
phase SELECT_REALTIME_SINGLE_MIGRATION_TOC \
  python3 scripts/operations/realtime_seeded_ledger_gate.py select-ledger \
    --toc "$work/derived/realtime.toc" \
    --out "$work/derived/realtime-migrations-only.toc"
docker cp "$work/derived/realtime-migrations-only.toc" \
  "$db:/tmp/dialektik_sync_replay/realtime-migrations-only.toc"
phase EXTRACT_REALTIME_ARCHIVED_VERSION_LEDGER \
  docker exec "$db" pg_restore --data-only \
    --use-list /tmp/dialektik_sync_replay/realtime-migrations-only.toc \
    --file /tmp/dialektik_sync_replay/realtime-migrations.sql \
    /tmp/dialektik_sync_replay/realtime-data.dump
docker cp "$db:/tmp/dialektik_sync_replay/realtime-migrations.sql" \
  "$work/derived/realtime-migrations.sql"
if ! docker exec "$db" psql -XAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "COPY (SELECT version, inserted_at FROM realtime.schema_migrations
       ORDER BY version) TO STDOUT;" \
  > "$work/derived/realtime-local-migrations.private" \
  2> "$work/derived/realtime-target-error.private"; then
  echo 'SYNC_REALTIME_LOCAL_MIGRATIONS=FAIL_REDACTED'; exit 1
fi
phase CHECK_REALTIME_ALL_91_VERSIONS_EXACT \
  python3 scripts/operations/realtime_seeded_ledger_gate.py compare \
    --source-sql "$work/derived/realtime-migrations.sql" \
    --target-copy "$work/derived/realtime-local-migrations.private"
phase FILTER_ONLY_PRESEEDED_REALTIME_VERSIONS \
  python3 scripts/operations/realtime_seeded_ledger_gate.py exclude-if-compatible \
    --toc "$work/derived/realtime.toc" \
    --out "$work/derived/realtime-version-ledger-excluded.toc" \
    --versions-proved
docker cp "$work/derived/realtime-version-ledger-excluded.toc" \
  "$db:/tmp/dialektik_sync_replay/realtime-version-ledger-excluded.toc"
phase RESTORE_SYNC_MANAGED_realtime \
  docker exec "$db" pg_restore -U postgres -d postgres --data-only \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    --use-list /tmp/dialektik_sync_replay/realtime-version-ledger-excluded.toc \
    /tmp/dialektik_sync_replay/realtime-data.dump
echo 'REALTIME_SOURCE_MIGRATION_TIMESTAMPS_REPLAYED=FALSE'

for scope in vault; do
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
