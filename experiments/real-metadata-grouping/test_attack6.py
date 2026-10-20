#!/usr/bin/env python3
"""Attack 6 engineering regression suite; synthetic and known-error probes only.

Not independent Gold, not validation of physical-world claims.
"""
import copy
import unittest
from attack6_roles import extract,fold_with_offsets
from attack6 import run

def row(i,text,day="2024-06-18"):
    return {"id":f"t{i:02}","headline":text,
            "publisher":f"Publisher {i}",
            "published_on":day,
            "canonical_url":f"https://example.org/news/{i}"}

def corpus(*xs):
    return {"schema":"public-real-metadata-only-v1",
            "source_text_acquired":False,"articles":list(xs)}

def pair(a,b):
    return run(corpus(row(1,a),row(2,b)))["pair_decisions"][0]

class EvidenceRoles(unittest.TestCase):
    def test_unicode_offsets_remain_verbatim(self):
        x=row(1,"Gobierno rectifica y confirma que fenómeno afectó a Penco: tornado")
        res=extract(x)
        self.assertEqual(res["primary_action"],"CORRECTION")
        self.assertGreaterEqual(len(res["all_action_cues"]),2)
        for span in res["all_action_cues"]+res["contextual_physical_mentions"]:
            self.assertEqual(x["headline"][span["char_start"]:span["char_end"]],
                             span["verbatim"])
            self.assertEqual(span["source_field"],"headline")

    def test_confirmation_without_world_fact(self):
        e=extract(row(1,"Ministerio confirma un tornado en Penco"))
        self.assertEqual(e["primary_action"],"CONFIRMATION")
        self.assertEqual(e["claim_propositions"],[])
        self.assertEqual(e["contradiction_decisions"],[])
        self.assertIsNone(e["event_time"])

    def test_explanation_not_physical_incident(self):
        e=extract(row(1,"¿Tornado o tromba marina? Experto explica qué pasó en Penco"))
        self.assertEqual(e["primary_action"],"EXPLANATION")
        self.assertTrue(e["contextual_physical_mentions"])

    def test_statement_not_physical_incident(self):
        e=extract(row(1,"Vecinos relatan el paso de un tornado en Penco"))
        self.assertEqual(e["primary_action"],"TESTIMONY")

    def test_official_alert_lifecycle_distinct(self):
        e=extract(row(1,"Senapred declara alerta por tsunami en Valparaíso"))
        f=extract(row(2,"Senapred levanta alerta por tsunami en Valparaíso"))
        self.assertEqual(e["primary_action"],"ALERT_ISSUED")
        self.assertEqual(f["primary_action"],"ALERT_CANCELLED")
        self.assertEqual(e["contradiction_decisions"],[])

    def test_retrospective_documentation_is_not_incident(self):
        e=extract(row(1,"Fotos muestran daños del tornado en Penco"))
        self.assertEqual(e["primary_action"],"RETROSPECTIVE_DOCUMENTATION")

    def test_retraction_word_does_not_create_contradiction(self):
        e=extract(row(1,"Gobierno descarta nueva alerta por tornado en Penco"))
        self.assertEqual(e["primary_action"],"RETRACTION_OR_DENIAL")
        self.assertEqual(e["contradiction_decisions"],[])

    def test_temporal_mentions_not_event_time(self):
        e=extract(row(1,"Video del tornado el 18 de junio de 2024 en Penco"))
        self.assertTrue(any(x["kind"]=="EXPLICIT_CALENDAR_DATE"
                            for x in e["time_mentions"]))
        self.assertIsNone(e["event_time"])
        f=extract(row(2,"Tornado causó daños ayer en Penco"))
        self.assertTrue(any(x["kind"]=="RELATIVE_TIME"
                            for x in f["time_mentions"]))
        self.assertIsNone(f["event_time"])

    def test_multiple_occurrences_not_forced(self):
        e=extract(row(1,"Varios incidentes con tornados en dos comunas"))
        self.assertTrue(e["multi_incident_lexical_cue"])
        self.assertEqual(e["multi_occurrence_edges"],[])

    def test_correction_not_merged_with_physical_event(self):
        p=pair("Tornado causa daños en Penco",
               "Gobierno rectifica y confirma que fenómeno de Penco fue tornado")
        self.assertEqual(p["decision"],"SAME_THREAD_DIFFERENT_OCCURRENCE")
        self.assertEqual(p["authority"],"UNVERIFIED_METADATA_HYPOTHESIS")

    def test_explanation_not_merged_with_physical_event(self):
        p=pair("Tornado provoca daños en Penco",
               "¿Tornado o tromba marina? Experto explica fenómeno en Penco")
        self.assertEqual(p["decision"],"SAME_THREAD_DIFFERENT_OCCURRENCE")

    def test_testimony_not_merged_with_physical_event(self):
        p=pair("Tornado causa daños en Penco",
               "Vecinos relatan tornado que arrasó techos en Penco")
        self.assertEqual(p["decision"],"SAME_THREAD_DIFFERENT_OCCURRENCE")

    def test_two_distinct_physical_places_not_same(self):
        p=pair("Tornado destruye casas en Penco",
               "Tornado causa daños en Arauco")
        self.assertNotEqual(p["decision"],"SAME_OCCURRENCE")

    def test_physical_physical_keeps_non_authoritative_hypothesis(self):
        p=pair("Tornado destruye casas en Penco",
               "Tornado causa daños en Penco")
        self.assertEqual(p["decision"],"SAME_OCCURRENCE")
        self.assertIn("NOT_VERIFIED",p["reason"])

    def test_same_topic_different_day_not_false_contradiction(self):
        result=run(corpus(row(1,"Tornado deja daños en Penco","2024-06-18"),
                          row(2,"Tornado deja daños en Penco","2024-07-18")))
        self.assertNotEqual(result["pair_decisions"][0]["decision"],"SAME_OCCURRENCE")
        self.assertEqual(result["contradictions_detected"],0)

    def test_permutation_and_no_authority(self):
        rows=[row(1,"Tornado causa daños en Penco"),
              row(2,"Gobierno confirma el tornado en Penco"),
              row(3,"Tornado provoca destrozos en Arauco")]
        a=run(corpus(*rows))
        b=run(corpus(*list(reversed(rows))))
        self.assertEqual(a,b)
        self.assertFalse(a["production_permission"])
        self.assertFalse(a["source_body_used"])
        self.assertFalse(a["claim_extraction_performed"])
        self.assertEqual(a["database_writes"],0)
        self.assertEqual(a["contradictions_detected"],0)

    def test_leaked_gold_rejected(self):
        x=row(1,"Tornado causa daños en Penco");x["occurrence_gold"]="bad"
        with self.assertRaises(ValueError):
            run(corpus(x,row(2,"Tornado causa daños en Penco")))

if __name__=="__main__":
    unittest.main()
