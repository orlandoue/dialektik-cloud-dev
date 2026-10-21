#!/usr/bin/env python3
"""Fail-closed, source-redacted structural audit for synchronized encrypted DEV data.

No network; only accepts the exact expected archive file names and byte hashes.
Never releases SQL, Auth row values, IDs, migration versions or fingerprints.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

ARCHIVES=(
 "public-full.snapshot.dump",
 "auth-data.snapshot.dump",
 "migration-ledger.snapshot.dump",
 "storage-data.snapshot.dump",
 "realtime-data.snapshot.dump",
 "vault-data.snapshot.dump",
)
HASHED=(*ARCHIVES,"managed-coverage.json")
EXPECTED=set((*HASHED,"SCOPE.json","SHA256SUMS"))
HASH_LINE=re.compile(r'^([0-9a-f]{64})  ([a-z0-9.-]+)$',re.ASCII)

def validate_tar(path:Path,dest:Path)->None:
    if not path.is_file() or path.stat().st_size>200_000_000:
        raise ValueError("INPUT")
    dest.mkdir(mode=0o700,exist_ok=False)
    with tarfile.open(path,mode='r:') as tar:
        members=tar.getmembers()
        if len(members)!=len(EXPECTED) or set(x.name for x in members)!=EXPECTED:
            raise ValueError("ALLOWLIST")
        for m in members:
            if not m.isfile() or m.size<1 or m.size>60_000_000 or '/' in m.name:
                raise ValueError("ENTRY")
            blob=tar.extractfile(m)
            if blob is None:
                raise ValueError("ENTRY")
            with (dest/m.name).open('xb') as target:
                while True:
                    data=blob.read(65536)
                    if not data:break
                    target.write(data)
            (dest/m.name).chmod(0o600)
    lines=(dest/"SHA256SUMS").read_text('ascii').splitlines()
    parsed={}
    for line in lines:
        match=HASH_LINE.fullmatch(line)
        if not match or match.group(2) in parsed:raise ValueError("SUMS")
        parsed[match.group(2)]=match.group(1)
    if set(parsed)!=set(HASHED):raise ValueError("SUMS")
    for name,expected in parsed.items():
        got=hashlib.sha256((dest/name).read_bytes()).hexdigest()
        if got!=expected:raise ValueError("HASH")
    scope=json.loads((dest/"SCOPE.json").read_text('utf8'))
    if not isinstance(scope,dict) or scope.get("format")!="dialektik-db-row-snapshot-synchronized-v1" or (
        scope.get("identical_exported_mvcc_snapshot_for_all_scopes") is not True
    ) or scope.get("source_verified_by_cert_pin") is not True or (
        scope.get("captured_schemas")!=["public","auth","supabase_migrations","storage","realtime","vault"]
    ) or scope.get("global_role_settings_captured") is not False or (
        scope.get("full_operational_restore_verified") is not False
    ):
        raise ValueError("SCOPE")

def main():
    if len(sys.argv)!=3:raise ValueError("ARGS")
    validate_tar(Path(sys.argv[1]),Path(sys.argv[2]))
    print("SYNCHRONIZED_ARCHIVE_ALLOWLIST_AND_HASHES=PASS")
    print("SYNCHRONIZED_ARCHIVE_MVCC_SCOPE_DECLARATION=PASS")
    print("AUTH_DATA_OR_SQL_ROWS_RELEASED=FALSE")
if __name__=="__main__":
    try:main()
    except Exception:
        print("SYNCHRONIZED_ARCHIVE_OFFLINE_AUDIT=FAIL_REDACTED",file=sys.stderr)
        raise SystemExit(1)
