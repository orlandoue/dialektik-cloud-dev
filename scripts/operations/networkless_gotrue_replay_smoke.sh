#!/usr/bin/env bash
# Only a disposable PG17 database already stripped of all external interfaces.
# Never prints Auth rows, identities, tokens, secrets, SQL or the test password.
set -euo pipefail
umask 077
db="$1"
work="$2"
test -n "$db" && test -d "$work" || exit 1
networks="$(docker inspect "$db" --format '{{json .NetworkSettings.Networks}}')"
mode="$(docker inspect "$db" --format '{{.HostConfig.NetworkMode}}')"
names="$(docker inspect "$db" --format '{{range $n,$v := .NetworkSettings.Networks}}{{println $n}}{{end}}')"
if [ "$networks" != '{}' ] && ! { [ "$mode" = none ] && [ "$names" = none ]; }; then
  echo 'AUTH_API_ISOLATION=FAIL_UNSAFE_NETWORK'
  exit 1
fi
docker image inspect public.ecr.aws/supabase/gotrue:v2.197.0 >/dev/null
docker image inspect node:22-alpine >/dev/null
envpath="$work/gotrue-ephemeral.env"
token="$(openssl rand -hex 40)"
cat > "$envpath" <<ENV
API_EXTERNAL_URL=http://localhost:9999
GOTRUE_API_HOST=0.0.0.0
GOTRUE_API_PORT=9999
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres?search_path=auth
GOTRUE_JWT_SECRET=$token
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_EXP=3600
GOTRUE_SITE_URL=http://localhost:9999
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_DISABLE_SIGNUP=false
ENV
chmod 0600 "$envpath"
unset token
auth='dialektik_gotrue_networkless_fixture'
cleanup() {
 docker rm -f "$auth" >/dev/null 2>&1 || true
 rm -f -- "$envpath"
 echo 'NETWORKLESS_AUTH_CONTAINER_CLEANUP=COMPLETE'
}
trap cleanup EXIT
docker run -d --rm --name "$auth" --network "container:$db" \
  --env-file "$envpath" public.ecr.aws/supabase/gotrue:v2.197.0 \
  > "$work/gotrue-container-private.log" 2>&1 || {
  echo 'NETWORKLESS_GOTRUE_START=FAIL_REDACTED'; exit 1;
}
docker run --rm --network "container:$db" \
  -e CI_AUTH_NO_EGRESS=TRUE \
  -v "$PWD/.github/scripts/networkless-auth-api-smoke.mjs:/smoke.mjs:ro" \
  node:22-alpine node /smoke.mjs > "$work/gotrue-api-private.log" 2>&1 || {
  echo 'NETWORKLESS_GOTRUE_SMOKE=FAIL_REDACTED'; exit 1;
}
for m in NETWORKLESS_GOTRUE_HEALTH NETWORKLESS_FIXTURE_PASSWORD_LOGIN \
 NETWORKLESS_FIXTURE_JWT_IDENTITY NETWORKLESS_BAD_AUTH_REJECTED; do
 grep -Fxq "$m=PASS" "$work/gotrue-api-private.log" || exit 1
 echo "$m=PASS"
done
for m in ORIGINAL_USER_PASSWORD_TOUCHED EXTERNAL_NETWORK_AUTH_API_EXPOSED; do
 grep -Fxq "$m=FALSE" "$work/gotrue-api-private.log" || exit 1
 echo "$m=FALSE"
done
echo 'NETWORKLESS_GOTRUE_SMOKE=PASS'
