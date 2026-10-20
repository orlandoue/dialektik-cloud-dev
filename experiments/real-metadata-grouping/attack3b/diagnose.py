#!/usr/bin/env python3
"""After-prediction failure analysis; references/Gold prohibited."""
import json
from collections import Counter
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from attack3 import evidence, classify

def main():
    corpus=json.loads((Path(__file__).parent/'corpus.json').read_text(encoding='utf-8'))
    rows=[evidence(x) for x in corpus['articles']]
    places=Counter(row['place'] or 'MISSING' for row in rows)
    hazards=Counter(row['hazard'] or 'MISSING' for row in rows)
    venue=Counter(row['venue'] or 'MISSING' for row in rows)
    actions=Counter(row['primary_action'] for row in rows)
    reasons=Counter()
    decisions=Counter()
    for i,a in enumerate(rows):
        for b in rows[i+1:]:
            label,why=classify(a,b)
            decisions[label]+=1
            reasons[why]+=1
    both=sum(bool(x['place'] and x['hazard']) for x in rows)
    triple=sum(bool(x['place'] and x['hazard'] and x['venue']) for x in rows)
    report={'docs':len(rows),'both_place_hazard':both,'triple_place_hazard_venue':triple,
      'signal_place':dict(sorted(places.items())),'signal_hazard':dict(sorted(hazards.items())),
      'signal_venue':dict(sorted(venue.items())),'action_kinds':dict(sorted(actions.items())),
      'decision_counts':dict(sorted(decisions.items())),'reason_counts':dict(sorted(reasons.items())),
      'research_gate':'NO_GO_ZERO_COVERAGE' if not any(k!='UNKNOWN' and n>0 for k,n in decisions.items()) else 'REVIEW_REQUIRED',
      'gold_access':False,'candidate_modified':False}
    print(json.dumps(report,sort_keys=True,indent=2,ensure_ascii=False))

if __name__=='__main__':
    main()
