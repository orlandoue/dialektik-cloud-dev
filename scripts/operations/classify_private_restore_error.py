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

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--private-log",type=Path,required=True)
    args=p.parse_args()
    raw=args.private_log.read_text(encoding="utf-8",errors="replace")
    if len(raw)>1_000_000:
        raise ValueError("RESTORE_LOG_EXCEEDS_PRIVATE_CLASSIFIER_LIMIT")
    print("REDACTED_RESTORE_FAILURE_CATEGORY="+category(raw))
    print("ROLE_NAMES_AND_SQL_CONTENT_SUPPRESSED=TRUE")

if __name__=="__main__":
    main()
