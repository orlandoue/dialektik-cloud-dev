#!/usr/bin/env python3
"""ATTACK 6: headline-only primary-action and contextual-reference evidence spans.

No publisher body, no claims, no contradictions, no knowledge of gold labels.
Each span points to exact title characters; no article date becomes event time.
"""
from __future__ import annotations
import re
import unicodedata

VERSION = "attack6-headline-actions-v1"

# Priority is deliberately explicit; these are *title-word cues*, not proof
# that a real-world act occurred or that the underlying report is true.
CUES = (
 ("CORRECTION", r"\b(rectifica(?:n)?|rectifico|corrige(?:n)?|corrigio)\b"),
 ("RETRACTION_OR_DENIAL", r"\b(descarta(?:n)?|desmiente(?:n)?|niega(?:n)?|nego)\b"),
 ("CONFIRMATION", r"\b(confirma(?:n)?|confirmo|ratifica(?:n)?)\b"),
 ("ALERT_CANCELLED", r"\b(cancelan?|cancelo|levantan?|levanto|desactiva(?:n)?)\s+(?:la |el |una |un )?(?:alerta|alarma|aviso|precaucion)\b"),
 ("ALERT_ISSUED", r"\b(decreta(?:n)?|declara(?:n)?|emite(?:n)?|activa(?:n)?|dispone(?:n)?)\s+(?:la |el |una |un )?(?:alerta|alarma|aviso|evacuacion|estado de excepcion)\b"),
 ("EXPLANATION", r"\b(explica(?:n)?|explico|diferencia entre|que es|cual fue|tornado o tromba marina)\b"),
 ("TESTIMONY", r"\b(relata(?:n)?|relato|testimonio|cuenta(?:n)?|vecin[oa]s? aseguran?|asegura(?:n)? que|testigo)\b"),
 ("RETROSPECTIVE_DOCUMENTATION", r"\b(fotos?|videos?|imagenes|registro|muestran|balance|danos tras|tras paso|consecuencias|recuento)\b"),
 ("ATTRIBUTED_STATEMENT", r"\b(alcalde(?:sa)?|ministro|presidente|gobierno)\b.{0,60}\b(asegura|afirma|dijo|sostuvo|advierte|califica|anuncia)\b"),
 ("PHYSICAL_EVENT_REPORT", r"\b(tornado|tromba marina|incendio|sismo|temblor|terremoto|inundacion|aluvion|tsunami|apagon)\b"),
)
REFERENCE = r"\b(tornado|tromba marina|incendio|sismo|temblor|terremoto|inundacion|aluvion|tsunami|apagon)\b"
TEMPORAL = (
 ("EXPLICIT_CALENDAR_DATE", r"\b(?:el\s+)?(?:[12]?\d|3[01])\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}\b"),
 ("RELATIVE_TIME", r"\b(?:hoy|ayer|manana|este (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|este miercoles|el dia despues|tras el paso)\b"),
)
MULTI = re.compile(r"\b(otros? (?:incendios|tornados|hechos|ataques)|multiples (?:hechos|eventos|emergencias)|"
                   r"distintos (?:lugares|puntos)|varios (?:hechos|incidentes)|"
                   r"desde .{0,25} hasta .{0,25}|"
                   r"en (?:dos|tres|cuatro|cinco) comunas)\b")
PATTERNS = [(kind,re.compile(expr)) for kind,expr in CUES]
REFERENCES = re.compile(REFERENCE)
TIME_PATTERNS = [(kind,re.compile(expr)) for kind,expr in TEMPORAL]

def fold_with_offsets(s: str) -> tuple[str,list[int]]:
    """Preserve offsets into original Unicode title, including accented glyphs."""
    text=[];indices=[]
    for i,c in enumerate(s):
        normalized=unicodedata.normalize("NFD", c.casefold())
        for ch in normalized:
            if unicodedata.category(ch)=="Mn":continue
            text.append(ch)
            indices.append(i)
    return "".join(text),indices

def _evidence(title, index, folded, mapping, kind, match):
    start,end=mapping[match.start()], mapping[match.end()-1]+1
    return {
      "evidence_id":f"{index}:{kind}:{start}-{end}",
      "article_id":index,"source_field":"headline",
      "char_start":start,"char_end":end,"verbatim":title[start:end],
      "evidence_status":"HEADLINE_WORDING_NOT_WORLD_VERIFICATION",
      "kind":kind
    }

def extract(article: dict) -> dict:
    title=article["headline"]; ident=article["id"]
    folded,mapping=fold_with_offsets(title)
    found=[]
    for kind,pattern in PATTERNS:
        matches=list(pattern.finditer(folded))
        if matches:
            found.extend(_evidence(title,ident,folded,mapping,kind,m) for m in matches)
    # The ordering of CUES is the primary-action precedence; NOT the earliest
    # token in the headline (a later 'rectifica' can still be the main action).
    primary=next((kind for kind,_ in PATTERNS
                  if any(x["kind"]==kind for x in found)),"UNKNOWN")
    refs=[_evidence(title,ident,folded,mapping,"MENTIONS_PHYSICAL_TYPE",m)
          for m in REFERENCES.finditer(folded)]
    temporal=[]
    for kind,regex in TIME_PATTERNS:
        temporal.extend(_evidence(title,ident,folded,mapping,kind,m)
                        for m in regex.finditer(folded))
    multi=bool(MULTI.search(folded))
    # Two different locations/occurrences must be resolved downstream; here we
    # do not coerce the headline's references to any one real-world event ID.
    return {
      "id":ident,"primary_action":primary,
      "primary_action_evidence":next((x for x in found if x["kind"]==primary),None),
      "all_action_cues":sorted(found,key=lambda x:(x["char_start"],x["kind"])),
      "contextual_physical_mentions":sorted(refs,key=lambda x:x["char_start"]),
      "time_mentions":sorted(temporal,key=lambda x:x["char_start"]),
      "event_time":None,"event_time_status":"NOT_ESTABLISHED_FROM_HEADLINE",
      "published_on":article["published_on"],
      "multi_incident_lexical_cue":multi,
      "multi_occurrence_edges":[],"world_occurrence_ids":[],
      "claim_propositions":[],"contradiction_decisions":[],
      "model_scope":"UNVERIFIED_HEADLINE_ONLY",
    }
