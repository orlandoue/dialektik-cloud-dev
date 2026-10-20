#!/usr/bin/env python3
"""Validate real encrypted bundle AFTER decrypt in ephemeral protected runner.

Inspects only filenames, sizes, SHA-256, backup structure. Never prints
real data, Auth users, SQL, passphrase, session values or source body.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import re
import tarfile
import sys
from managed_backup_inventory import audit, sanitize_roles_sql

EXPECTED_FILES={
    "roles.sql","schema.sql","data.sql",
    "managed-auth.dump","managed-ledger.dump",
    "SHA256SUMS","managed-coverage.json",
}
SUMMED=EXPECTED_FILES-{"SHA256SUMS","managed-coverage.json"}

def verify_tar(path:pathlib.Path,target:pathlib.Path)->None:
    with tarfile.open(path,mode="r:") as t:
        members=t.getmembers()
        if {m.name for m in members}!=EXPECTED_FILES or len(members)!=len(EXPECTED_FILES):
            raise ValueError("BUNDLE_FILES_INCOMPLETE_OR_UNEXPECTED")
        if any(not m.isfile() or not 0<m.size<250_000_000 for m in members):
            raise ValueError("UNSAFE_ARCHIVE_ENTRY_OR_SIZE")
        if sum(m.size for m in members)>350_000_000:
            raise ValueError("BUNDLE_TOTAL_TOO_LARGE")
        target.mkdir(mode=0o700,parents=True,exist_ok=False)
        for m in members:
            with t.extractfile(m) as src, (target/m.name).open("xb") as dest:
                if src is None: raise ValueError("ARCHIVE_MEMBER_NOT_A_FILE")
                while data:=src.read(1024*1024):
                    dest.write(data)
    sums=(target/"SHA256SUMS").read_text(encoding="utf-8")
    seen={}
    for line in sums.splitlines():
        m=re.fullmatch(r"([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)",line)
        if not m:raise ValueError("INVALID_BUNDLE_SHA256_FILE")
        expected,name=m.groups()
        if name in seen or name not in SUMMED:
            raise ValueError("DUPLICATE_OR_UNEXPECTED_BUNDLE_HASH")
        seen[name]=expected
    if set(seen)!=SUMMED:raise ValueError("INCOMPLETE_BUNDLE_HASHES")
    for name,value in seen.items():
        actual=hashlib.sha256((target/name).read_bytes()).hexdigest()
        if actual!=value:raise ValueError("ENCRYPTED_BUNDLE_SOURCE_HASH_MISMATCH")
    coverage=json.loads((target/"managed-coverage.json").read_text())
    if coverage.get("restoration_verified") is not False or coverage.get("auth_tables_total",0)<27 or coverage.get("ledger_tables_total",0)!=1:
        raise ValueError("MANAGED_ARCHIVE_COVERAGE_NOT_ESTABLISHED")
    print("AUTH_LEDGER_AND_APP_BUNDLE_SOURCE_HASHES=PASS")
    print("GPG_BUNDLE_FILE_ALLOWLIST=PASS")
    print("REAL_RESTORE_VERIFIED=FALSE")

def safe_sql(source:pathlib.Path,dest:pathlib.Path)->None:
    # Only a narrowly bounded, standalone PostgreSQL session SET is removable.
    # NEVER modify/overwrite source backup. Restoring an edited copy must be
    # audited as a derived replay, not a byte-identical reproduction.
    text=source.read_text(encoding="utf-8")
    replacement,n=sanitize_roles_sql(text)
    dest.write_text(replacement,encoding="utf-8")
    dest.chmod(0o600)
    print("ISOLATED_DERIVED_REPLAY_SESSION_SETTING_REMOVALS="+str(n))

def main():
    p=argparse.ArgumentParser()
    sub=p.add_subparsers(dest="mode",required=True)
    v=sub.add_parser("verify")
    v.add_argument("--tar",type=pathlib.Path,required=True)
    v.add_argument("--dest",type=pathlib.Path,required=True)
    s=sub.add_parser("sanitize")
    s.add_argument("--input",type=pathlib.Path,required=True)
    s.add_argument("--output",type=pathlib.Path,required=True)
    a=p.parse_args()
    if a.mode=="verify": verify_tar(a.tar,a.dest)
    else: safe_sql(a.input,a.output)

if __name__=="__main__":
    main()
