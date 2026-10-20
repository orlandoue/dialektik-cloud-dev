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

# This is deliberately exact and narrowly allowed: do not blindly remove
# platform role grants, security policy, extensions, or function definitions.
SPECIAL_SET=re.compile(
    r"^\s*SET\s+log_min_messages\s*(?:=|TO)\s*"
    r"(?:'(?:warning|notice|error)'|(?:warning|notice|error))\s*;\s*$",
    flags=re.IGNORECASE,
)

def sanitize_roles_sql(text: str) -> tuple[str,int]:
    lines=text.splitlines(keepends=True)
    removed=0
    sanitized=[]
    for line in lines:
        if SPECIAL_SET.fullmatch(line.strip()):
            removed+=1
            sanitized.append("-- ISOLATED_RESTORE_ONLY: stripped nonprivileged log_min_messages SET\n")
        else:
            sanitized.append(line)
    if removed>3:
        raise ValueError("TOO_MANY_PLATFORM_LOG_PARAMETER_STMTS")
    return "".join(sanitized),removed

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
