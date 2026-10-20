"""Generic headline signatures. Metadata only; no event IDs or gold labels."""
import re
import unicodedata
from urllib.parse import urlsplit
from datetime import date

PLACE = (
 ("estacion_central","estacion central"),
 ("pedro_aguirre_cerda","pedro aguirre cerda"),
 ("las_condes","las condes"),
 ("puente_alto","puente alto"),
 ("mulchen","mulchen"),
 ("penalolen","penalolen"),
 ("cerrillos","cerrillos"),
 ("maipu","maipu"),
 ("santiago","santiago"),
)
HAZARD = (
 ("tornado",r"\btornad"),
 ("mudslide",r"\b(aluvion|aludes|deslizamiento)\b"),
 ("fire",r"\b(incendio|incendia|queman|quemado|quemada|en llamas)\b"),
 ("avalanche",r"\bavalancha"),
 ("storm",r"\b(tormenta|lluvia torrencial|granizada)\b"),
 ("outage",r"\b(apagon|sin energia electrica|corte de luz)\b"),
 ("looting",r"\b(saqueo|saquear)\b"),
 ("protest",r"\b(manifestaciones|protestas|conmemoracion)\b"),
)
FOCUS = (
 ("rescue",r"\b(rescatar|rescate|atrapada|atrapado|salvan a)\b"),
 ("administrative",r"\b(coordinan|catastro|gobernador|municipio revela)\b"),
 ("aftermath",r"\b(imagenes|perdida|danos|demolicion|dia despues|las cifras)\b"),
 ("investigation",r"\b(investigan|peritajes|atribuyen)\b"),
)
VENUE = (
 ("theater",r"\bteatro municipal\b"),
 ("bus",r"\b(bus|microbus)\b"),
 ("supermarket",r"\b(supermercado|lider)\b"),
 ("houses",r"\b(viviendas|casas)\b"),
)
MULTI = re.compile(r"\b(otro atacado|varios incidentes|hechos de violencia|un bus quemado, otro|y un intento de saqueo)\b")
OCT18 = re.compile(r"\b(18.?o\b|18 de octubre|conmemoracion del 18|aniversario del estallido)\b")

def normalize(s):
    return "".join(c for c in unicodedata.normalize("NFD",s.lower())
                   if unicodedata.category(c)!="Mn")

def signature(row):
    url=urlsplit(row["canonical_url"])
    if url.scheme!="https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("INVALID_SOURCE_URL")
    title=normalize(row["headline"])
    urlpath=normalize(url.path.replace("-"," "))
    named=lambda text:next((key for key,phrase in PLACE if re.search(r"(?<!\w)"+re.escape(phrase)+r"(?!\w)",text)),None)
    place=named(title) or named(urlpath)
    hazards=[key for key,pattern in HAZARD if re.search(pattern,title)]
    venue=next((key for key,pattern in VENUE if re.search(pattern,title)),None)
    focus=next((key for key,pattern in FOCUS if re.search(pattern,title)),"incident")
    date.fromisoformat(row["published_on"])
    return {
      "place":place,"hazard":hazards[0] if len(hazards)==1 else None,
      "venue":venue,"focus":focus,
      "multi":bool(MULTI.search(title)) or len(hazards)>1,
      "oct18":bool(OCT18.search(title)),
      "date":row["published_on"],"publisher":row["publisher"]
    }
