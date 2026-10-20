#!/usr/bin/env python3
"""Classify a privileged ephemeral psql restore failure without exposing its text.

Only emits an allowlisted fixed diagnosis code, never SQL, role names, line
numbers, user data, credentials, or source content. Fails closed if ambiguous.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import re

CLASSES=(
 ("EXISTING_ROLE_COLLISION",r'(?:role|rol)\s+["\x27].*?["\x27]\s+already exists'),
 ("MISSING_DEPENDENT_ROLE",r'(?:role|rol)\s+["\x27].*?["\x27]\s+does not exist'),
 ("INSUFFICIENT_PRIVILEGE",r'permission denied|must be (?:superuser|owner|member of)|insufficient privilege'),
 ("PARAMETER_PERMISSION",r'permission denied (?:for|to set) parameter|must be superuser to set parameter'),
 ("DUPLICATE_OBJECT",r'already exists|duplicate_object'),
 ("MISSING_DEPENDENCY",r'does not exist|undefined_object'),
 ("INVALID_CONFIGURATION",r'unrecognized configuration parameter|invalid parameter value'),
 ("SYNTAX_ERROR",r'syntax error at or near'),
 ("CLIENT_CONNECTION",r'could not connect|connection refused|no such file or directory'),
)

def category(log:str)->str:
    # Skip original SQL and sanitize by reducing entire input to one code.
    if not log.strip():return "NO_REDACTED_LOG_CAPTURED"
    lower=log.lower()
    # Presence of an ERROR is required; no speculative classification.
    if "error:" not in lower and "fatal:" not in lower:
        return "UNKNOWN_NON_SQL_FAILURE"
    found={name for name,pat in CLASSES if re.search(pat,lower,re.DOTALL)}
    # Broad categories are overridden by the more precise variants.
    if "PARAMETER_PERMISSION" in found:
        found.discard("INSUFFICIENT_PRIVILEGE")
    if "EXISTING_ROLE_COLLISION" in found:
        found.discard("DUPLICATE_OBJECT")
    if "MISSING_DEPENDENT_ROLE" in found:
        found.discard("MISSING_DEPENDENCY")
    # Multiple distinct classes deserve investigation: do not guess.
    if len(found)>1:return "MULTIPLE_INCOMPATIBLE_CATEGORIES"
    return next(iter(found),"UNKNOWN_SQL_FAILURE")

# Only disclose explicitly audited, non-secret PostgreSQL configuration names.
# Values, role identifiers, query text, source lines and free-form names are
# never emitted. UNRECOGNIZED has no fallback raw value.
SAFE_PARAMETER_NAMES={
    "log_min_messages":"LOG_MIN_MESSAGES",
    "client_min_messages":"CLIENT_MIN_MESSAGES",
    "default_transaction_read_only":"DEFAULT_TRANSACTION_READ_ONLY",
    "search_path":"SEARCH_PATH",
    "statement_timeout":"STATEMENT_TIMEOUT",
}
PERMISSION_PARAMETER=re.compile(
    r'''(?:permission denied (?:for|to set) parameter|must be superuser to set parameter)\s+["']?([a-z_][a-z0-9_.]*)''',
    flags=re.IGNORECASE,
)

def parameter_marker(log:str)->str:
    if category(log)!="PARAMETER_PERMISSION":
        return "NOT_APPLICABLE"
    found={m.group(1).lower() for m in PERMISSION_PARAMETER.finditer(log)}
    if len(found)>1:
        return "MULTIPLE_PARAMETER_IDENTIFIERS"
    if not found:
        return "UNAVAILABLE"
    item=next(iter(found))
    return SAFE_PARAMETER_NAMES.get(item,"NON_ALLOWLISTED_PARAMETER")

def safe_report(log:str)->dict[str,str]:
    return {
        "REDACTED_RESTORE_FAILURE_CATEGORY":category(log),
        "REDACTED_POSTGRES_PARAMETER":parameter_marker(log),
        "ROLE_NAMES_AND_SQL_CONTENT_SUPPRESSED":"TRUE",
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--private-log",type=Path,required=True)
    args=p.parse_args()
    raw=args.private_log.read_text(encoding="utf-8",errors="replace")
    if len(raw)>1_000_000:
        raise ValueError("RESTORE_LOG_EXCEEDS_PRIVATE_CLASSIFIER_LIMIT")
    for key,value in safe_report(raw).items():
        print(key+"="+value)

if __name__=="__main__":
    main()
