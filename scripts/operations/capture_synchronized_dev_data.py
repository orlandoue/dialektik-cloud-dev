#!/usr/bin/env python3
"""Capture synchronized DEV PostgreSQL row versions, protected CI only.

Never print source SQL, rows, credentials, snapshot identifier or connection URL.
No database mutations. Public schema DDL/DATA and every non-system managed
table-data schema use pg_dump sessions sharing one exported MVCC snapshot.
Globals (roles/passwords) are not part of PostgreSQL MVCC snapshots.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit

SNAPSHOT = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{8}-[0-9]+$", re.ASCII)
EXPECTED_HOST = "aws-0-us-east-1.pooler.supabase.com"
EXPECTED_USER = "postgres.vclsswwfhljczxgnsciq"
CA_PIN = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
IMAGE = "postgres:17.11"
DUMPS = (
    ("public", "public-full.snapshot.dump", False),
    ("auth", "auth-data.snapshot.dump", True),
    ("supabase_migrations", "migration-ledger.snapshot.dump", True),
    ("storage", "storage-data.snapshot.dump", True),
    ("realtime", "realtime-data.snapshot.dump", True),
    ("vault", "vault-data.snapshot.dump", True),
)

class GateError(Exception):
    pass

def verify_target(url: str) -> None:
    try:
        data = urlsplit(url)
        safe = (
            data.scheme in ("postgres", "postgresql")
            and data.hostname == EXPECTED_HOST and data.port == 5432
            and unquote(data.username or "") == EXPECTED_USER
            and len(unquote(data.password or "")) >= 12
            and data.path == "/postgres" and data.fragment == ""
            and parse_qs(data.query) == {"sslmode": ["verify-full"]}
        )
    except Exception:
        safe = False
    if not safe:
        raise GateError("CAPTURE_SOURCE_TARGET_DENIED")

def verify_ca(value: str) -> str:
    options = (value, value.replace("\r\n", "\n"),
               value.replace("\r\n", "\n").rstrip("\n") + "\n")
    for candidate in options:
        if hashlib.sha256(candidate.encode()).hexdigest() == CA_PIN:
            return candidate
    raise GateError("CAPTURE_CA_PIN_INVALID")

def docker_base(work: Path) -> list[str]:
    return ["docker", "run", "--rm",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "-v", f"{work}:/work:rw", "-e", "DEV_URL",
            IMAGE]

def safe_call(cmd: list[str], phase: str, env=None, timeout=180) -> str:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              check=False, timeout=timeout, env=env)
    except Exception as exc:
        raise GateError(phase+"_TRANSPORT_FAILED") from None
    if proc.returncode != 0:
        raise GateError(phase+"_FAILED")
    return proc.stdout.strip()

def main() -> None:
    url = os.environ.get("DEV_URL", "")
    verify_target(url)
    root = Path(os.environ.get("RUNNER_TEMP", "/none"))
    if not root.is_dir() or not str(root).startswith("/home/runner/work/_temp"):
        raise GateError("CAPTURE_RUNNER_TEMP_DENIED")
    work = root / "dialektik-synchronized-capture"
    work.mkdir(mode=0o700, exist_ok=False)
    ca = verify_ca(os.environ.get("DEV_CA_PEM", ""))
    (work / "ca.pem").write_text(ca, encoding="utf-8")
    (work / "ca.pem").chmod(0o600)
    base = docker_base(work)
    url_arg = '"$DEV_URL&sslrootcert=/work/ca.pem"'
    # Establish exactly the pinned TLS identity, before the snapshot.
    identity = safe_call(base + ["sh", "-euc",
      'exec psql '+url_arg+' -XAt -v ON_ERROR_STOP=1 -c "SELECT current_database() || chr(124) || current_user || chr(124) || current_setting('+"'"+'server_version'+"'"+')"'
    ], "CAPTURE_REMOTE_IDENTITY")
    if identity != "postgres|postgres|17.11":
        raise GateError("CAPTURE_REMOTE_IDENTITY_MISMATCH")
    print("CAPTURE_TLS_AND_DATABASE_IDENTITY=PASS", flush=True)

    # Keep the exporter transaction open until all other pg_dump sessions
    # terminate successfully. No source rows or snapshot ID printed.
    exporter_command = [*base[:-1], "-i", base[-1], "sh", "-euc",
        "exec psql "+url_arg+" -qAt -v ON_ERROR_STOP=1"]
    exp = subprocess.Popen(exporter_command,
         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
         text=True, bufsize=1)
    try:
        if exp.stdin is None or exp.stdout is None:
            raise GateError("CAPTURE_SNAPSHOT_EXPORTER_UNAVAILABLE")
        exp.stdin.write("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n")
        exp.stdin.flush()
        sid = exp.stdout.readline().strip()
        if not SNAPSHOT.fullmatch(sid):
            raise GateError("CAPTURE_EXPORTED_SNAPSHOT_INVALID")
        for schema, filename, data_only in DUMPS:
            cmd = [
              *base[:-1], "-e", "SNAP_ID="+sid,
              "-e", "SCHEMA="+schema,
              "-e", "OUT_NAME="+filename,
              "-e", "DATA_ONLY="+("yes" if data_only else "no"),
              base[-1], "sh", "-euc",
              'if [ "$DATA_ONLY" = yes ]; then mode=--data-only; else mode=--format=custom; fi; ' +
              'exec pg_dump --dbname='+url_arg+
              ' --snapshot="$SNAP_ID" --format=custom ' +
              ' --no-owner --no-privileges --schema="$SCHEMA" ' +
              ' --file="/work/$OUT_NAME" $mode'
            ]
            safe_call(cmd, "CAPTURE_SYNCHRONIZED_ARCHIVE", timeout=240)
            if not (work / filename).is_file() or (work / filename).stat().st_size < 100:
                raise GateError("CAPTURE_ARCHIVE_EMPTY")
        exp.stdin.write("COMMIT;\n")
        exp.stdin.flush()
        exp.stdin.close()
        if exp.wait(timeout=20):
            raise GateError("CAPTURE_SNAPSHOT_TRANSACTION_FAILED")
    finally:
        if exp.poll() is None:
            exp.kill()
            exp.wait(timeout=10)
    print("CAPTURE_SINGLE_MVCC_SNAPSHOT_ALL_DB_SCOPES=PASS", flush=True)

    for filename, toc in (
       ("auth-data.snapshot.dump", "auth.snapshot.toc"),
       ("migration-ledger.snapshot.dump", "ledger.snapshot.toc"),
    ):
        manifest = safe_call(
            base + ["pg_restore", "--list", "/work/"+filename],
            "CAPTURE_MANAGED_ARCHIVE_TOC")
        (work / toc).write_text(manifest+"\n",encoding="utf-8")
    catalog = safe_call([
        sys.executable, "scripts/operations/managed_backup_inventory.py",
        "--auth-toc",str(work/"auth.snapshot.toc"),
        "--ledger-toc",str(work/"ledger.snapshot.toc"),
        "--auth-archive",str(work/"auth-data.snapshot.dump"),
        "--ledger-archive",str(work/"migration-ledger.snapshot.dump"),
        "--out",str(work/"managed-coverage.json")
    ], "CAPTURE_MANAGED_COVERAGE")
    # Never print raw contents of catalog or backup files.
    print("CAPTURE_AUTH_27_TABLES_AND_LEDGER_COVERAGE=PASS", flush=True)
    filenames = [item[1] for item in DUMPS]+["managed-coverage.json"]
    for filename in filenames:
        if not (work / filename).is_file():
            raise GateError("CAPTURE_MISSING_REQUIRED_FILE")
    with (work/"SHA256SUMS").open("w",encoding="ascii") as output:
        for filename in filenames:
            digest = hashlib.sha256((work/filename).read_bytes()).hexdigest()
            output.write(digest+"  "+filename+"\n")
    policy = {
      "format": "dialektik-db-row-snapshot-synchronized-v1",
      "postgres_major": 17,
      "source_verified_by_cert_pin": True,
      "identical_exported_mvcc_snapshot_for_all_scopes": True,
      "captured_schemas": [x[0] for x in DUMPS],
      "application_schema_and_data": "public only",
      "managed_schema_mode": "data only",
      "global_role_settings_captured": False,
      "auth_api_compatibility_tested": False,
      "full_operational_restore_verified": False
    }
    (work/"SCOPE.json").write_text(json.dumps(policy,sort_keys=True)+"\n",encoding="utf-8")
    print("SYNCHRONIZED_CAPTURE_PLAINTEXT_PUBLICATION=FALSE",flush=True)

if __name__ == "__main__":
    try:
        main()
    except GateError as exc:
        print(exc.args[0],file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("SYNCHRONIZED_CAPTURE=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
