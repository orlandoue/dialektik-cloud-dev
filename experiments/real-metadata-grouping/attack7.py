#!/usr/bin/env python3
"""ATTACK 7: source-offset evidence graph for Spanish news HEADLINE METADATA.

Research-only, offline, deterministic. Article-local occurrence mentions are
NOT event IDs. Numerical evidence is an observation proposal, NOT a claim truth.
Candidate relations are retrieval links, not SAME_OCCURRENCE assertions.
No scraping, DB writes, production model, contradiction decisions, or Gold use.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import date
import hashlib
from itertools import combinations
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

from attack5 import load_geography, feature as geo_feature, geo_relation
from attack6_roles import fold_with_offsets

VERSION = "attack7-evidence-graph-v1"
MAX_ARTICLES = 48

# Event families and article/documentary actions are orthogonal. None of these
# implies a verified world occurrence or that the headline's statement is true.
PHENOMENA = {
 "FIRE": r"\b(?:incendios?|siniestros?|fuego|llamas|quema(?:do|das)?)\b",
 "FLOOD": r"\b(?:inundaciones?|desbordes?|anegamientos?|aluviones?|crecida(?:s)?)\b",
 "STORM": r"\b(?:sistema frontal|temporales?|lluvias? intensas?)\b",
 "MINING_ACCIDENT": r"\b(?:derrumbes?|accidentes? mineros?|mina colapsada|tragedia minera)\b",
 "RESCUE": r"\b(?:rescates?|rescat(?:an|aron|ar|e)|busqueda de mineros|trabajadores desaparecidos)\b",
 "EARTHQUAKE": r"\b(?:sismos?|temblores?|terremotos?)\b",
 "TORNADO": r"\b(?:tornados?|tromba marina)\b",
 "OUTAGE": r"\b(?:apagones?|cortes? de luz|sin suministro electrico)\b",
 "TSUNAMI": r"\b(?:tsunamis?|maremotos?)\b",
}
ACTIONS = (
 ("RECTIFICATION", r"\b(?:rectifica(?:n)?|corrige(?:n)?|rectifico|corrigio)\b"),
 ("DENIAL", r"\b(?:desmiente(?:n)?|descarta(?:n)?|niega(?:n)?|nego)\b"),
 ("CONFIRMATION", r"\b(?:confirma(?:n)?|confirmo|ratifica(?:n)?|ratifico)\b"),
 ("EMERGENCY_ORDER", r"\b(?:ordenan?|ordeno|solicita(?:n)?|piden|dispone(?:n)?|decreta(?:n)?|"
                     r"declara(?:n)?|suspende(?:n)?|clausura(?:n)?)\b"),
 ("OFFICIAL_BALANCE", r"\b(?:balance|cifra(?:s)?|inform(?:a|o|an|aron)|reporta(?:n)?|"
                      r"ya son|asciende(?:n)?|aumento|aumentan|sml)\b"),
 ("INVESTIGATION", r"\b(?:fiscalia|pdi|peritaje(?:s)?|investiga(?:n)?|"
                   r"identific(?:an|ar|ar)?|indagatoria)\b"),
 ("RESCUE_OPERATION", r"\b(?:rescate|rescatar|rescatistas|busqueda|"
                     r"avanzan \d+ metros|localizan)\b"),
 ("TESTIMONY", r"\b(?:relata(?:n|ron)?|relato|testimonio|testigo|"
                r"habla sobreviviente|vecin[oa]s? (?:cuenta|asegura))\b"),
 ("RETROSPECTIVE", r"\b(?:fotos?|videos?|imagenes|dia despues|"
                     r"consecuencias|tras el paso|balance de danos)\b"),
)
NUMERIC = {
 "DEATHS_REPORTED": re.compile(r"\b(?:(\d{1,4})\s+(?:personas?\s+)?(?:fallecid[oa]s?|muert[oa]s?|victimas fatales)|"
                              r"(?:fallecid[oa]s?|muert[oa]s?)\s+(?:aumenta(?:n)?\s+a|asciende(?:n)?\s+a|ya son|de)\s+(\d{1,4})|"
                              r"(?:ya son|aumento a|aumentan a)\s+(\d{1,4})\s+(?:los?\s+)?fallecid[oa]s?)\b"),
 "HOMES_AFFECTED": re.compile(r"\b(?:(\d{1,6})\s+(?:viviendas?|casas?)\s+(?:afectadas?|destruidas?)|"
                             r"(?:viviendas?|casas?)\s+(?:afectadas?|destruidas?)\s+(?:a|de)\s+(\d{1,6}))\b"),
 "PEOPLE_EVACUATED": re.compile(r"\b(\d{1,6})\s+(?:personas?\s+)?evacuad[oa]s?\b"),
}
# Multi-location headlines cannot map automatically to one bounded episode.
MULTI = re.compile(r"\b(?:diversos? sectores?|distintas? comunas?|en \d+ comunas?|"
                   r"varios incendios|multiples incidentes|entre .{3,20} y .{3,20}|"
                   r"desde .{3,20} hasta .{3,20})\b")
RELATIVE_TIME = re.compile(r"\b(?:hoy|ayer|manana|este (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|"
                           r"tras el paso|el dia despues|este miercoles)\b")
DATE_TIME = re.compile(r"\b(?:[12]?\d|3[01])\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|"
                       r"julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}\b")

def folded_span(original: str, folded: str, mapping: list[int], m: re.Match) -> dict:
    s,e=mapping[m.start()],mapping[m.end()-1]+1
    return {"field":"headline","start":s,"end":e,"verbatim":original[s:e]}

def node_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:18]

def mentions(row: dict, geography: dict) -> dict:
    title=row["headline"]
    folded,mapping=fold_with_offsets(title)
    geo=geo_feature(row,geography)
    phenomena=[]
    for family,rx in PHENOMENA.items():
        for m in re.finditer(rx,folded):
            phenomena.append({"family":family,**folded_span(title,folded,mapping,m)})
    actions=[]
    for typ,rx in ACTIONS:
        for m in re.finditer(rx,folded):
            actions.append({"type":typ,**folded_span(title,folded,mapping,m)})
    actions.sort(key=lambda x:(x["start"],x["type"]))
    # An action is the PRIMARY DOCUMENTARY role, not necessarily a new physical
    # world occurrence. Multiple verbs survive as separate source observations.
    priority=[x for x,_ in ACTIONS]
    primary=next((x for x in priority if any(z["type"]==x for z in actions)),
                 "EVENT_REPORT" if phenomena else "UNKNOWN")
    numbers=[]
    for category,rx in NUMERIC.items():
        for m in rx.finditer(folded):
            raw_value=next((v for v in m.groups() if v),None)
            if raw_value is None:continue
            numbers.append({"kind":category,"value":int(raw_value),
              "value_is_verified":False,"observation_as_of":None,
              "observation_time_status":"NOT_ESTABLISHED",
              "target_occurrence_id":None,
              **folded_span(title,folded,mapping,m)})
    times=[]
    for typ,pattern in (("EXPLICIT_DATE",DATE_TIME),("RELATIVE_TIME",RELATIVE_TIME)):
        for m in pattern.finditer(folded):
            times.append({"kind":typ,"resolved_to_event_time":False,
                          **folded_span(title,folded,mapping,m)})
    facility=[]
    # Typed facility candidates are NOT verified external geocoding records.
    # A name shared across titles helps retrieval but cannot establish identity.
    for rx in (r"\b(?:mina\s+)?el teniente\b",r"\bplanta\s+[a-z][a-z0-9]+\b",
               r"\bterminal(?:\s+de buses)?\s+(?:de |del )?[a-z][a-z0-9]+\b"):
        for m in re.finditer(rx,folded):
            alias="el teniente" if "teniente" in m.group(0) else m.group(0)
            facility.append({"entity_type":"FACILITY_CANDIDATE",
                             "normalized_alias":alias,
                             "external_registry_id":None,
                             **folded_span(title,folded,mapping,m)})
    return {
      "id":row["id"],"publisher":row["publisher"],"url":row["canonical_url"],
      "headline":title,"published_on":row["published_on"],
      "primary_documentary_action":primary,
      "primary_action_evidence":[x for x in actions if x["type"]==primary][:1],
      "actions":actions,"physical_mentions":phenomena,"numeric_observations":numbers,
      "temporal_mentions":times,"facility_candidates":facility,
      "geography":geo["geography"],
      "multi_occurrence_cue":bool(MULTI.search(folded)),
      "event_time":None,"primary_world_occurrence_id":None,
      "full_source_text_used":False,
    }

def make_graph(corpus: dict) -> dict:
    if corpus.get("schema")!="public-real-metadata-only-v1" or corpus.get("source_text_acquired") is not False:
        raise ValueError("REQUIRES_AUTHORIZED_METADATA_ONLY_CONTRACT")
    rows=corpus.get("articles")
    if not isinstance(rows,list) or not 2<=len(rows)<=MAX_ARTICLES:
        raise ValueError("BOUNDED_INPUT_2_TO_48")
    geo=load_geography()
    prepared={}
    seen_urls=set()
    for row in rows:
        if not isinstance(row,dict) or set(row)!={"id","headline","canonical_url","publisher","published_on"}:
            raise ValueError("PROHIBITED_INPUT_OR_GOLD")
        if any(not isinstance(x,str) or not x for x in row.values()) or not re.fullmatch(r"[a-z][0-9]{2,3}",row["id"]):
            raise ValueError("INVALID_ARTICLE")
        date.fromisoformat(row["published_on"])
        url=urlsplit(row["canonical_url"])
        if url.scheme!="https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("URL_POLICY")
        if row["id"] in prepared or row["canonical_url"] in seen_urls:
            raise ValueError("DUPLICATE_ARTICLE_OR_URL")
        seen_urls.add(row["canonical_url"])
        prepared[row["id"]]=mentions(row,geo)

    graph_nodes=[]
    graph_edges=[]
    article_index={}
    for ident in sorted(prepared):
        a=prepared[ident]
        art_id=f"article:{ident}"
        article_index[ident]=a
        graph_nodes.append({"id":art_id,"kind":"Article","publisher":a["publisher"],
                            "source_url":a["url"],"published_on":a["published_on"],
                            "authority":"SOURCE_METADATA_ONLY"})
        action_id=f"action:{ident}"
        graph_nodes.append({"id":action_id,"kind":"DocumentaryAction",
                            "action_type":a["primary_documentary_action"],
                            "world_action_verified":False,
                            "event_time":None,"source_evidence":a["primary_action_evidence"]})
        graph_edges.append({"from":art_id,"to":action_id,"type":"REPORTS_PRIMARY_ACTION",
                            "authority":"TITLE_HEURISTIC"})
        for ix,ev in enumerate(a["physical_mentions"]):
            mid=f"mention:{ident}:{ix:02d}"
            graph_nodes.append({"id":mid,"kind":"PhysicalPhenomenonMention",
                                "family":ev["family"],"source_evidence":ev,
                                "world_occurrence_id":None})
            graph_edges.append({"from":art_id,"to":mid,"type":"MENTIONS_PHENOMENON",
                                "authority":"VERBATIM_TITLE_ONLY"})
        for ix,place in enumerate(a["geography"]):
            pid=f"georef:{ident}:{ix:02d}"
            graph_nodes.append({"id":pid,"kind":"GeographicalMention",
                                "type":place["kind"],"identifiers":place["ids"],
                                "regions":place["regions"],"lexeme":place["text"],
                                "source":"chile-hub-third-party-DPA"})
            graph_edges.append({"from":art_id,"to":pid,"type":"MENTIONS_LOCATION",
                                "authority":"ADMINISTRATIVE_NAME_MATCH"})
        for ix,fac in enumerate(a["facility_candidates"]):
            fid=f"facility:{ident}:{ix:02d}"
            graph_nodes.append({"id":fid,"kind":"FacilityMention",
                                "alias":fac["normalized_alias"],
                                "verified_external_id":None,"source_evidence":fac})
            graph_edges.append({"from":art_id,"to":fid,"type":"MENTIONS_FACILITY",
                                "authority":"LEXICAL_ONLY"})
        for ix,obs in enumerate(a["numeric_observations"]):
            oid=f"observation:{ident}:{ix:02d}"
            graph_nodes.append({"id":oid,"kind":"NumericObservationProposal",
                                "metric":obs["kind"],"reported_value":obs["value"],
                                "observation_as_of":None,"event_time":None,
                                "claim_truth_status":"NOT_VERIFIED",
                                "source_evidence":obs})
            graph_edges.append({"from":art_id,"to":oid,"type":"CONTAINS_REPORTED_QUANTITY",
                                "authority":"VERBATIM_TITLE_NOT_VALIDATED_CLAIM"})
    pair_candidates=[]
    for ida,idb in combinations(sorted(prepared),2):
        a,b=prepared[ida],prepared[idb]
        day_gap=abs((date.fromisoformat(a["published_on"])-date.fromisoformat(b["published_on"])).days)
        ga={p for m in a["geography"] if m["kind"]=="GEO_COMMUNE" for p in m["ids"]}
        gb={p for m in b["geography"] if m["kind"]=="GEO_COMMUNE" for p in m["ids"]}
        fa={p["normalized_alias"] for p in a["facility_candidates"]}
        fb={p["normalized_alias"] for p in b["facility_candidates"]}
        ka={p["family"] for p in a["physical_mentions"]}
        kb={p["family"] for p in b["physical_mentions"]}
        shared_g=sorted(ga&gb)
        shared_f=sorted(fa&fb)
        shared_k=sorted(ka&kb)
        # Retrieval is broad and explicit: topic overlap is NOT evidence that
        # the same bounded occurrence happened; no pair becomes an equivalence.
        retrieved=bool(day_gap<=14 and
                       (shared_f or (shared_g and shared_k) or
                        (shared_k and a["publisher"]!=b["publisher"] and day_gap<=2
                         and (shared_g or shared_f))))
        if retrieved:
            reason=("SHARED_FACILITY_ALIAS_CANDIDATE" if shared_f else
                    "SHARED_COMMUNE_PHENOMENON_CANDIDATE")
            pair_candidates.append({
                "ids":[ida,idb],"relation":"REVIEW_CANDIDATE_ONLY",
                "reason":reason,"days_between_publications":day_gap,
                "shared_commune_codes":shared_g,"shared_facility_aliases":shared_f,
                "shared_phenomena":shared_k,
                "same_bounded_occurrence":None,
                "thread_identity":None,
                "contradiction":None,
                "status":"ABSTAIN_ON_WORLD_RELATION",
            })
    return {
        "schema":"attack7-typed-evidence-graph-v1",
        "candidate_count":len(pair_candidates),"article_count":len(prepared),
        "nodes":graph_nodes,"edges":graph_edges,
        "retrieval_candidates":pair_candidates,
        "article_facets":[{"article_id":k,
                           "primary_documentary_action":prepared[k]["primary_documentary_action"],
                           "phenomena":sorted({x["family"] for x in prepared[k]["physical_mentions"]}),
                           "facility_aliases":sorted({x["normalized_alias"] for x in prepared[k]["facility_candidates"]}),
                           "reported_numeric_observations":prepared[k]["numeric_observations"],
                           "time_mentions":prepared[k]["temporal_mentions"],
                           "geographical_mentions":prepared[k]["geography"],
                           "event_time":None,"world_occurrence_id":None}
                          for k in sorted(prepared)],
        "asserted_same_occurrence_edges":0,"asserted_contradictions":0,
        "database_writes":0,"production_permission":False,
        "formal_r14_or_v10_11_execution":False,
        "source_bodies_acquired":False,
        "limits":[
          "Metadata-only typed evidence is not an independently validated event graph.",
          "Physical events and their reports/statements have separate article-local nodes.",
          "No verified event-time, observation-as-of time, global occurrence identity or contradiction.",
          "Two reports with differing figures may be temporal updates, not contradictions.",
          "Facility alias candidate is not a verified facility identity or geolocation.",
          "Review candidates are not an automatic Event grouping or published contradiction."
        ],
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True)
    p.add_argument("--out",required=True)
    args=p.parse_args()
    raw=Path(args.input).read_bytes()
    data=make_graph(json.loads(raw))
    output=(json.dumps(data,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
    Path(args.out).write_bytes(output)
    print("SCHEMA="+data["schema"])
    print("CORPUS_SHA256="+hashlib.sha256(raw).hexdigest())
    print("OUTPUT_SHA256="+hashlib.sha256(output).hexdigest())
    print("ARTICLES="+str(data["article_count"]))
    print("GRAPH_NODES="+str(len(data["nodes"])))
    print("REVIEW_CANDIDATES="+str(data["candidate_count"]))
    print("SAME_OCCURRENCE_ASSERTED=0")
    print("CONTRADICTIONS_ASSERTED=0")
    print("DATABASE_WRITES=0")
    print("SCIENTIFIC_GATE=UNSCORED")
    print("PRODUCTION_PERMISSION=FALSE")

if __name__=="__main__":
    main()
