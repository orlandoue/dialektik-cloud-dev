#!/usr/bin/env python3
"""Prepare a pg_restore TOC that excludes ONE already-present Auth ledger.

Requires a separate verified exact comparison of the archived Auth migration
version SET with the disposable target. This script NEVER checks the version
sets and NEVER grants permission to run its output without that external gate.
The SOURCE backup remains unchanged and the resulting list is for offline
disposable restore only.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re

_TABLE_DATA = re.compile(
    r'^\s*\d+;\s+\d+\s+\d+\s+TABLE DATA\s+auth\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+'
)
REQUIRED={'users','identities','sessions','refresh_tokens'}

def prepare(toc: str) -> tuple[str, dict]:
    if len(toc)>2_000_000: raise ValueError("RESTORE_TOC_SIZE_LIMIT")
    entries=[]
    result=[]
    excluded=0
    for line in toc.splitlines(keepends=True):
        m=_TABLE_DATA.match(line)
        if not m:
            result.append(line)
            continue
        name=m.group(1)
        entries.append(name)
        if name=="schema_migrations":
            excluded+=1
            # Use pg_restore's native COMMENT convention for TOC exclusions.
            result.append(";" + line)
        else:
            result.append(line)
    if len(entries)!=27 or len(set(entries))!=27:
        raise ValueError("AUTH_ARCHIVE_TABLE_INVENTORY_NOT_EXACTLY_27")
    if excluded!=1 or not REQUIRED.issubset(set(entries)):
        raise ValueError("AUTH_MIGRATION_EXCLUSION_PRECONDITION_FAILURE")
    changed="".join(result)
    if changed.replace(";" + next(line for line in toc.splitlines(keepends=True)
                                 if (_TABLE_DATA.match(line) is not None and
                                     _TABLE_DATA.match(line).group(1)=="schema_migrations")),
                       next(line for line in toc.splitlines(keepends=True)
                            if (_TABLE_DATA.match(line) is not None and
                                _TABLE_DATA.match(line).group(1)=="schema_migrations")),1)!=toc:
        raise ValueError("UNEXPECTED_TOC_CHANGES")
    return changed, {
        "excluded_auth_migration_entries":1,
        "retained_auth_data_entries":26,
        "source_archive_modified":False,
        "source_target_version_equality_verified_here":False,
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--toc-in",type=Path,required=True)
    p.add_argument("--toc-out",type=Path,required=True)
    p.add_argument("--version-sets-confirmed-identical",action="store_true")
    args=p.parse_args()
    if not args.version_sets_confirmed_identical:
        raise ValueError("EXPLICIT_ARCHIVE_VS_TARGET_VERSION_EQUALITY_REQUIRED")
    out,stats=prepare(args.toc_in.read_text())
    if args.toc_out.exists():
        raise ValueError("PRIVATE_TOC_OUTPUT_ALREADY_EXISTS")
    with args.toc_out.open("x",encoding="utf-8") as target:
        target.write(out)
    args.toc_out.chmod(0o600)
    for key,value in stats.items():
        print("TOC_"+key.upper()+"="+str(value).upper() if isinstance(value,bool)
              else "TOC_"+key.upper()+"="+str(value))
    print("AUTH_ARCHIVE_DATA_USED_OR_REPLAYED=FALSE")

if __name__=="__main__":main()
