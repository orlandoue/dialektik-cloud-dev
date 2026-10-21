#!/usr/bin/env python3
"""Compare a disposable local Auth schema with READ-ONLY source catalog evidence.

The pinned input is schema metadata only (no Auth identities, users, sessions,
passwords, tokens, access secrets or table rows). Outputs only mismatch counts.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import json
import re

# Captured from read-only pg_catalog query on dialektik-dev 2026-10-20/21.
# Keys: table name, number of columns, checksum of ordered column/type/
# nullability/default declarations. The checksum is NOT a digest of row data.
SOURCE_AUTH_CATALOG={
    "audit_log_entries": (5,"ba42663cd4a9d2a97d9d685516b23d33"),
    "custom_oauth_providers": (25,"5cc2be60bebe03f6c783e4098f108450"),
    "flow_state": (17,"55d3547e30c9e0fb63fed7b1be7e3a65"),
    "identities": (9,"f9c61f7b18dbc2d29a02d8f56a7325d4"),
    "instances": (5,"b02ab12e8b4d0f6f23fde7d947684473"),
    "mfa_amr_claims": (5,"43f2d218005198b4c049a2d2ff116a24"),
    "mfa_challenges": (7,"638be838ded624a4bb7f38b5a92e8afc"),
    "mfa_factors": (13,"d4eee341080a5a1ea0e889140990de2b"),
    "mfa_recovery_code_sets": (7,"270748cd667937a98470af32cf58d8a1"),
    "mfa_recovery_codes": (5,"8cc46cd9bf18306c5e12f3f34da5f9ed"),
    "oauth_authorizations": (17,"1d653b825e72f9de13ebce8fdee2a8b4"),
    "oauth_client_states": (4,"6ce1cbe52aad9f95e736873c929ab282"),
    "oauth_clients": (13,"87fba9b5afdd82b9c32234d5b707b0f0"),
    "oauth_consents": (6,"0f237ebb8d8f052ed79a66cff2cf2ef7"),
    "one_time_tokens": (8,"ff3ff9e33808324117bac40ba55f977a"),
    "refresh_tokens": (9,"53974303948f00d8c0e7ad4a095790b6"),
    "saml_providers": (9,"1fe8be60eab3769bf500274cced9c183"),
    "saml_relay_states": (8,"f7cfd985d1589b32a51bebdb1ba79acd"),
    "schema_migrations": (1,"2380571bb641ba8c6aa3704b2c13bb03"),
    "scim_tokens": (8,"cfea02a467dfb3d2437742261a905e40"),
    "scim_users": (10,"bd487c7d90c26d6a2916934c782f8d18"),
    "sessions": (15,"57609210ac39710017078fd3532ba844"),
    "sso_domains": (5,"cc2490daf1e3a2fb6165dba9f041b344"),
    "sso_providers": (5,"bd96700184c149937740acd28fa54da6"),
    "users": (35,"3b3ddf1a84a2542bbd8529b7d5c8044d"),
    "webauthn_challenges": (6,"0ecd9f231415b45f65f91261cd3157fd"),
    "webauthn_credentials": (14,"13876a1083ff3de64ddec6a8da9957ed"),
}
VALID_NAME=re.compile(r"^[a-z_][a-z0-9_]*$")
VALID_DIGEST=re.compile(r"^[0-9a-f]{32}$")

def compare(rows:str)->dict:
    target={}
    for line in rows.splitlines():
        parts=line.strip().split("|")
        if len(parts)!=3:
            raise ValueError("INVALID_LOCAL_CATALOG_FORMAT")
        table,cols,digest=parts
        if (not VALID_NAME.fullmatch(table)
            or not cols.isascii() or not cols.isdecimal()
            or not VALID_DIGEST.fullmatch(digest) or table in target):
            raise ValueError("INVALID_LOCAL_AUTH_CATALOG_ENTRY")
        target[table]=(int(cols),digest)
    baseline=set(SOURCE_AUTH_CATALOG)
    missing=baseline-set(target)
    extras=set(target)-baseline
    different_cols={table for table in baseline & set(target)
                    if target[table][0]!=SOURCE_AUTH_CATALOG[table][0]}
    different_shapes={table for table in baseline & set(target)
                    if target[table][1]!=SOURCE_AUTH_CATALOG[table][1]}
    return {
        "source_tables":len(baseline),
        "local_tables":len(target),
        "missing_source_tables":len(missing),
        "extra_local_tables":len(extras),
        "column_count_mismatches":len(different_cols),
        "full_column_default_fingerprint_mismatches":len(different_shapes),
        "same_name_catalog_only":not missing and not extras,
        "exact_catalog_compatibility":not (missing or extras or different_shapes),
        "data_restore_completed":False,
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--local-catalog",type=Path,required=True)
    a=p.parse_args()
    result=compare(a.local_catalog.read_text())
    for key,value in result.items():
        print("AUTH_CATALOG_"+key.upper()+"="+str(value).upper() if isinstance(value,bool)
              else "AUTH_CATALOG_"+key.upper()+"="+str(value))
    print("AUTH_IDENTITIES_OR_SQL_PUBLISHED=FALSE")

if __name__=="__main__":main()
