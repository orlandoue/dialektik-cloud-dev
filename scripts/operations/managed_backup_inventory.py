#!/usr/bin/env python3
"""Offline validation of supplemental managed-schema PostgreSQL backups.

No database credentials, network requests, DB mutations or decrypted data
printed. Refuse to treat CLI's default export as a recoverable Auth backup.
Run after pg_restore --list on custom-format archives.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

REQUIRED = {
    "auth": ("users", "identities", "sessions", "refresh_tokens"),
    "supabase_migrations": ("schema_migrations",),
}

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def toc_table_data(toc: str) -> dict[str, set[str]]:
    present: dict[str,set[str]] = {}
    for line in toc.splitlines():
        if line.startswith(";"):
            continue
        # Custom-format pg_restore --list: "... TABLE DATA schema table owner"
        match = re.search(
            r"^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+"
            r"(auth|supabase_migrations)\s+([a-zA-Z0-9_]+)\s+",
            line,
        )
        if match:
            present.setdefault(match.group(1),set()).add(match.group(2))
    return present

def audit(auth_toc: str, ledger_toc: str) -> dict:
    a=toc_table_data(auth_toc);l=toc_table_data(ledger_toc)
    cross=(a.get("supabase_migrations",set()) | l.get("auth",set()))
    if cross:
        raise ValueError("CROSS_SCHEMA_ARCHIVE_CONTENT_FORBIDDEN")
    expected={
        "auth":set(REQUIRED["auth"]),
        "supabase_migrations":set(REQUIRED["supabase_migrations"]),
    }
    if not expected["auth"].issubset(a.get("auth",set())):
        raise ValueError("MANAGED_AUTH_CRITICAL_TABLES_MISSING")
    if not expected["supabase_migrations"].issubset(l.get("supabase_migrations",set())):
        raise ValueError("MIGRATION_LEDGER_TABLE_MISSING")
    return {
        "format":"dialektik-managed-backup-inventory-v1",
        "auth_required_tables_present":len(REQUIRED["auth"]),
        "ledger_required_tables_present":len(REQUIRED["supabase_migrations"]),
        "auth_tables_total":len(a.get("auth",set())),
        "ledger_tables_total":len(l.get("supabase_migrations",set())),
        "protected_contents_not_displayed":True,
        "restoration_verified":False
    }

# Restore-only reconciliation: this never modifies the encrypted source dump.
# The isolated PG replica has preexisting Supabase roles; the source may ask
# those roles (or the restore session) to set log_min_messages, a privileged
# LOGGING GUC. Skip ONLY an entire, bounded, literal statement setting that
# exact GUC. Never alter CREATE ROLE, login, password, BYPASSRLS or GRANT.
# Security-relevant settings, unknown statements and multiline forms remain.
_SQL_NAME = r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)'
_LOG_SEVERITY = r"(?:debug[1-5]|info|notice|warning|error|log|fatal|panic|default)"
_LOG_VALUE = rf"(?:'{_LOG_SEVERITY}'|{_LOG_SEVERITY})"
_LOG_ASSIGN = rf"(?:=|TO)\s*{_LOG_VALUE}"
_RESTORE_LOG_SETTINGS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("SESSION_SET", re.compile(
        rf"^\s*SET\s+log_min_messages\s*{_LOG_ASSIGN}\s*;\s*$", re.IGNORECASE)),
    ("ROLE_SET", re.compile(
        rf"^\s*ALTER\s+ROLE\s+{_SQL_NAME}"
        rf"(?:\s+IN\s+DATABASE\s+{_SQL_NAME})?"
        rf"\s+SET\s+log_min_messages\s*{_LOG_ASSIGN}\s*;\s*$", re.IGNORECASE)),
    ("DATABASE_SET", re.compile(
        rf"^\s*ALTER\s+DATABASE\s+{_SQL_NAME}"
        rf"\s+SET\s+log_min_messages\s*{_LOG_ASSIGN}\s*;\s*$", re.IGNORECASE)),
)
# Conservative upper bound. This protects against an unexpected role export.
_MAX_DERIVED_LOGGING_OVERRIDES = 48

def sanitize_roles_sql(text: str) -> tuple[str, int]:
    lines = text.splitlines(keepends=True)
    changed: list[str] = []
    removed = 0
    for line in lines:
        matched = next((kind for kind, pattern in _RESTORE_LOG_SETTINGS
                        if pattern.fullmatch(line.strip()) is not None), None)
        if matched:
            removed += 1
            changed.append(
                "-- ISOLATED_REPLAY_ONLY: skipped privileged logging GUC; "
                "source ciphertext unchanged\n"
            )
        else:
            changed.append(line)
    if removed > _MAX_DERIVED_LOGGING_OVERRIDES:
        raise ValueError("TOO_MANY_ISOLATED_REPLAY_LOGGING_OVERRIDES")
    return "".join(changed), removed

def validate_source_untouched(path: Path, original_hash: str) -> None:
    if not re.fullmatch(r"[a-f0-9]{64}",original_hash):
        raise ValueError("INVALID_SOURCE_DIGEST")
    if sha256(path)!=original_hash:
        raise ValueError("ENCRYPTED_OR_SOURCE_ARTIFACT_MODIFIED")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--auth-toc",type=Path,required=True)
    p.add_argument("--ledger-toc",type=Path,required=True)
    p.add_argument("--auth-archive",type=Path,required=True)
    p.add_argument("--ledger-archive",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    a=p.parse_args()
    result=audit(a.auth_toc.read_text(),a.ledger_toc.read_text())
    result["auth_custom_archive_sha256"]=sha256(a.auth_archive)
    result["ledger_custom_archive_sha256"]=sha256(a.ledger_archive)
    a.out.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n",encoding="utf-8")
    print("MANAGED_TABLE_COVERAGE=PASS")
    print("AUTH_TABLES_CONTAINED="+str(result["auth_tables_total"]))
    print("LEDGER_TABLES_CONTAINED="+str(result["ledger_tables_total"]))
    print("RESTORE_VALIDATED=FALSE")
    print("SENSITIVE_DATA_PRINTED=FALSE")

if __name__=="__main__":
    main()
