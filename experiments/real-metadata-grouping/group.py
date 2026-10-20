#!/usr/bin/env python3
"""Isolated metadata-only *candidate* occurrence linker. Not Dialektik V10.11.

Reads exactly corpus.json; DOES NOT read gold labels, source bodies, Supabase,
R14 evaluation inputs, credentials or any network. Geographic/hazard dictionaries
are generic, versioned, explicit policy choices; NOT fitted on a test set.
"""
from __future__ import annotations
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlparse

VERSION = "real-headline-metadata-rule-baseline-1"
GEOGRAPHY = (
    ("estacion_central", ("estacion central", "estacion-central")),
    ("las_condes", ("las condes", "las-condes")),
    ("mulchen", ("mulchen",)),
    ("los_andes", ("los andes", "los-andes")),
    ("santiago", ("santiago",)),
)
# These describe a generic type, not a particular occurrence or identity.
HAZARDS = (
    ("tornado", re.compile(r"\btornad\w*\b")),
    ("mudslide", re.compile(r"\b(aluvion|alud|deslizamiento)\b")),
    ("avalanche", re.compile(r"\bavalancha\b")),
    ("electric_outage", re.compile(r"\b(electric|energia electrica|apag[oó]n|sin luz)\b")),
)
MAX_PUBLICATION_GAP_DAYS = 2
MAX_ARTICLES = 40

def plain(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFD", text.lower())
                   if unicodedata.category(char) != "Mn")

def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("non-HTTPS public source")
    if parsed.query or parsed.fragment:
        raise ValueError("unexpected query or fragment in canonical URL")
    return url

def signals(article: dict) -> dict:
    # Headlines determine the type. URL path only supplements an explicit city;
    # URLs are *not* allowed to create a hazard signal by keyword leakage.
    headline = plain(article["headline"])
    slug = plain(urlparse(article["canonical_url"]).path.replace("-", " "))
    places_in_headline = [name for name, aliases in GEOGRAPHY
                          if any(alias.replace("-", " ") in headline for alias in aliases)]
    places = places_in_headline or [name for name, aliases in GEOGRAPHY
                                   if any(alias.replace("-", " ") in slug for alias in aliases)]
    # Prefer the more specific named municipality over a surrounding metro area.
    place = next((p for p in places if p != "santiago"), places[0] if places else None)
    kinds = [name for name, rule in HAZARDS if rule.search(headline)]
    kind = kinds[0] if len(kinds) == 1 else None
    return {"place": place, "hazard": kind,
            "published_on": article["published_on"], "source": article["publisher"]}

def run(corpus: dict) -> dict:
    if corpus.get("schema") != "public-real-metadata-only-v1" or corpus.get("source_text_acquired") is not False:
        raise ValueError("invalid metadata-only input contract")
    rows = corpus.get("articles")
    if not isinstance(rows, list) or not 2 <= len(rows) <= MAX_ARTICLES:
        raise ValueError("invalid bounded corpus")
    ids, urls = set(), set()
    by_id = {}
    sig = {}
    for row in rows:
        if set(row) != {"id", "publisher", "headline", "published_on", "canonical_url"}:
            raise ValueError("unapproved input data fields")
        identifier = row["id"]
        if not isinstance(identifier, str) or not re.fullmatch(r"m[0-9]{2,3}", identifier):
            raise ValueError("invalid source identifier")
        if identifier in ids:
            raise ValueError("duplicate document")
        ids.add(identifier)
        if not all(isinstance(row[k], str) and row[k] for k in row):
            raise ValueError("missing metadata")
        source_url = normalize_url(row["canonical_url"])
        if source_url in urls:
            raise ValueError("duplicate canonical URL")
        urls.add(source_url)
        date.fromisoformat(row["published_on"])
        by_id[identifier] = row
        sig[identifier] = signals(row)

    parents = {i:i for i in ids}
    def find(x):
        while parents[x] != x:
            x = parents[x]
        return x
    def union(a,b):
        roots = sorted((find(a), find(b)))
        parents[roots[1]] = roots[0]

    candidate_edges = []
    abstentions = {}
    for i in sorted(ids):
        if not sig[i]["place"] or not sig[i]["hazard"]:
            abstentions[i] = "INCOMPLETE_EXPLICIT_HEADLINE_SIGNATURE"
    ordered = sorted(ids)
    for ix, a in enumerate(ordered):
        for b in ordered[ix+1:]:
            sa,sb = sig[a],sig[b]
            if not (sa["place"] and sb["place"] and sa["hazard"] and sb["hazard"]):
                continue
            if sa["place"] != sb["place"] or sa["hazard"] != sb["hazard"]:
                continue
            if sa["source"] == sb["source"]:
                continue
            delta = abs((date.fromisoformat(sa["published_on"]) -
                         date.fromisoformat(sb["published_on"])).days)
            if delta > MAX_PUBLICATION_GAP_DAYS:
                continue
            candidate_edges.append({
                "ids": [a,b], "evidence": {
                    "shared_explicit_place":sa["place"],
                    "shared_headline_hazard":sa["hazard"],
                    "publication_gap_days":delta,
                    "different_publishers":True,
                },
                "status":"CANDIDATE_ONLY_NO_SEMANTIC_VERIFICATION",
            })
            union(a,b)
    clusters = {}
    for id_ in ordered:
        clusters.setdefault(find(id_), []).append(id_)
    linked = sorted((sorted(v) for v in clusters.values() if len(v)>1), key=lambda group:group[0])
    singletons = sorted(i for v in clusters.values() if len(v)==1 for i in v)
    return {
        "version":VERSION, "input_count":len(rows),
        "metadata_only":True, "semantic_model_used":False,
        "persistent_event_ids_created":0, "contradictions_inferred":0,
        "links":candidate_edges,
        "groups":[{"members":members,
                   "explanation":"Potentially same local physical occurrence, pending semantic verification"}
                  for members in linked],
        "singletons":singletons,
        "abstentions":abstentions,
    }

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",required=True)
    parser.add_argument("--output",required=True)
    args = parser.parse_args()
    inp = Path(args.input)
    out = Path(args.output)
    corpus = json.loads(inp.read_text(encoding="utf-8"))
    prediction = run(corpus)
    encoded = json.dumps(prediction,sort_keys=True,ensure_ascii=False,indent=2)+"\n"
    out.write_text(encoded,encoding="utf-8")
    print("PREDICTOR_VERSION="+VERSION)
    print("INPUT_SHA256="+hashlib.sha256(inp.read_bytes()).hexdigest())
    print("PREDICTIONS_SHA256="+hashlib.sha256(out.read_bytes()).hexdigest())
    print("METADATA_ROWS="+str(prediction["input_count"]))
    print("PROPOSED_GROUPS="+str(len(prediction["groups"])))
    print("SINGLES="+str(len(prediction["singletons"])))
    print("DECISION=NON_AUTHORITATIVE_METADATA_BASELINE")

if __name__=="__main__":
    main()
