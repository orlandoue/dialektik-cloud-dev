#!/usr/bin/env python3
"""Synthetic-only gates. Not an independent real-news evaluation."""
import unittest
from attack3 import run, complete_link

def row(n, title, publisher='Source', day='2026-10-07'):
    return {'id': f'x{n:02d}', 'publisher': publisher, 'headline': title,
            'published_on': day, 'canonical_url': f'https://example.org/item-{n}'}

def corpus(rows):
    return {'schema': 'public-real-metadata-only-v1', 'source_text_acquired': False, 'articles': rows}

class CandidateTests(unittest.TestCase):
    def test_speech_vs_incident_never_same(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Alcalde de Maipú tras incendio del Teatro Municipal: anuncia medidas', 'Other')]))
        self.assertEqual(r['pair_decisions'][0]['decision'], 'SAME_THREAD_DIFFERENT_OCCURRENCE')
        self.assertEqual(r['occurrence_groups'], [])

    def test_retrospective_documentation_may_be_same(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Imágenes de daños que causó el incendio del Teatro Municipal de Maipú', 'Other', '2026-10-08')]))
        self.assertEqual(r['pair_decisions'][0]['decision'], 'SAME_OCCURRENCE')

    def test_same_publisher_not_excluded(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Incendio controlado en Teatro Municipal de Maipú')]))
        self.assertEqual(r['pair_decisions'][0]['decision'], 'SAME_OCCURRENCE')

    def test_different_place(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Incendio afecta al Teatro Municipal de Las Condes', 'Other')]))
        self.assertEqual(r['pair_decisions'][0]['decision'], 'UNRELATED')

    def test_unknown_and_source_time_is_not_event_time(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Noticias de la región y balance de incidentes', 'Other')]))
        self.assertEqual(r['pair_decisions'][0]['decision'], 'UNKNOWN')
        self.assertTrue(all(a['event_time'] is None for a in r['articles']))

    def test_no_transitive_bridge(self):
        self.assertEqual(complete_link(['a', 'b', 'c'], {('a', 'b'), ('b', 'c')}), [['a', 'b']])

    def test_permutation(self):
        rows = [row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                row(2, 'Incendio en el Teatro Municipal de Maipú', 'Other'),
                row(3, 'Alcalde de Maipú tras incendio del Teatro Municipal: anuncia medidas', 'Another')]
        self.assertEqual(run(corpus(rows)), run(corpus(list(reversed(rows)))))

    def test_no_authority_or_contradictions(self):
        r = run(corpus([row(1, 'Incendio afecta al Teatro Municipal de Maipú'),
                        row(2, 'Alcalde tras incendio del Teatro Municipal de Maipú declara', 'Other')]))
        self.assertFalse(r['production_permission'])
        self.assertEqual(r['database_writes'], 0)
        self.assertEqual(r['contradictions_detected'], 0)

    def test_reject_gold_leak(self):
        x = row(1, 'Incendio afecta al Teatro Municipal de Maipú')
        x['gold_id'] = 'forbidden'
        with self.assertRaises(ValueError):
            run(corpus([x, row(2, 'Incendio en Teatro Municipal de Maipú')]))

if __name__ == '__main__':
    unittest.main()
