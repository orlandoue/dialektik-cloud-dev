#!/usr/bin/env python3
"""ATTACK4 post-frozen-prediction diagnostics; never reads reference labels."""
import collections
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from attack4 import run

def main():
    corpus=json.loads((Path(__file__).parent/'corpus.json').read_text(encoding='utf8'))
    out=run(corpus)
    docs=out['articles']
    counts={
      'articles':len(docs),
      'articles_with_any_orthographic_named_anchor':sum(bool(x['named_anchors']) for x in docs),
      'articles_without_named_anchor':sum(not x['named_anchors'] for x in docs),
      'articles_with_generic_hazard_kind':sum(bool(x['kind']) for x in docs),
      'articles_without_kind':sum(not x['kind'] for x in docs),
      'articles_with_object':sum(bool(x['objects']) for x in docs),
      'articles_without_object':sum(not x['objects'] for x in docs),
      'pair_retrievals':out['retrieved_pairs'],
      'retrieved_pairs_with_common_named_anchor':sum(p['retrieved'] and bool(p['evidence']['shared_named_anchors']) for p in out['pair_decisions']),
      'non_unknown_decisions':sum(p['decision']!='UNKNOWN' for p in out['pair_decisions']),
      'reason_counts':dict(sorted(collections.Counter(p['reason'] for p in out['pair_decisions']).items())),
      'recognized_named_anchor_examples':sorted({s for row in docs for s in row['named_anchors']})[:20],
      'gold_used':False, 'candidate_modified':False}
    print('POST_FROZEN_DIAGNOSTICS='+json.dumps(counts,ensure_ascii=False,sort_keys=True))

if __name__=='__main__':
    main()
