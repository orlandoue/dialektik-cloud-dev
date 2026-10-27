#!/usr/bin/env python3
"""Compare table names of authenticated source archive to isolated target catalog.

No row data, user IDs, emails or secrets. Names are fixed PG catalog identifiers.
Fail closed on even one missing managed table; never create fake Auth objects.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re
from managed_backup_inventory import toc_table_data

SAFE_NAME=re.compile(r"^[a-z_][a-z0-9_]*$")

def examine(auth_toc:str,ledger_toc:str,target_auth:str,target_ledger:str)->dict:
    source_a=toc_table_data(auth_toc).get("auth",set())
    source_m=toc_table_data(ledger_toc).get("supabase_migrations",set())
    local_a=set(target_auth.splitlines())
    local_m=set(target_ledger.splitlines())
    if not source_a or source_m!={"schema_migrations"}:
        raise ValueError("SOURCE_ARCHIVE_UNVERIFIED")
    if not all(SAFE_NAME.fullmatch(x) for x in source_a|source_m|local_a|local_m):
        raise ValueError("UNEXPECTED_PG_CATALOG_IDENTIFIER")
    missing_a=source_a-local_a
    missing_m=source_m-local_m
    result={
        "source_auth_tables":len(source_a),
        "source_ledger_tables":len(source_m),
        "target_auth_tables":len(local_a),
        "target_ledger_tables":len(local_m),
        "missing_source_auth_tables":len(missing_a),
        "missing_source_ledger_tables":len(missing_m),
        "compatible_table_names_only":False,
        "source_data_restored":False,
    }
    if missing_a or missing_m:
        raise ValueError(
            "DISPOSABLE_SUPABASE_TARGET_MISSING_TABLES_"
            +str(len(missing_a))+"_AUTH_"
            +str(len(missing_m))+"_LEDGER"
        )
    result["compatible_table_names_only"]=True
    return result

def main():
    p=argparse.ArgumentParser()
    for arg in ("auth-toc","ledger-toc","target-auth","target-ledger"):
        p.add_argument("--"+arg,required=True,type=Path)
    a=p.parse_args()
    r=examine(a.auth_toc.read_text(),a.ledger_toc.read_text(),
        a.target_auth.read_text(),a.target_ledger.read_text())
    print("TARGET_AUTH_TABLES_COMPATIBLE_BY_NAME=PASS")
    print("TARGET_AUTH_CATALOG_SIZE="+str(r["target_auth_tables"]))
    print("SOURCE_AUTH_ARCHIVE_TABLES="+str(r["source_auth_tables"]))
    print("TARGET_COLUMN_TYPE_COMPATIBILITY=UNVERIFIED")
    print("REAL_DATA_RESTORED=FALSE")
if __name__=="__main__": main()
