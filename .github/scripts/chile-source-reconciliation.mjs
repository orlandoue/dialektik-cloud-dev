import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export function audit(snapshot, review) {
  if (snapshot.schema !== 'dialektik-source-origin-audit-input-v1' ||
      review.schema !== 'dialektik-independent-url-review-v1' ||
      snapshot.records.length !== 13 || review.records.length !== 13) {
    throw Error('AUDIT_SCOPE_INVALID');
  }
  const items = [], seen = new Set();
  for (const row of snapshot.records) {
    const r = review.records.find(x => x.recordKey === row.recordKey);
    if (!r || seen.has(row.recordKey) || r.reviewedUrl !== row.canonicalUrl ||
        r.releaseAuthority !== false || r.rightsStatus !== 'NOT_ATTESTED')
      throw Error('REVIEW_INVALID');
    seen.add(row.recordKey);
    const url = new URL(row.canonicalUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        ![row.domain, 'www.' + row.domain].includes(url.hostname))
      throw Error('SOURCE_ORIGIN_MISMATCH');
    if (!/^[0-9a-f]{64}$/.test(row.receiptHash)) throw Error('BAD_RECEIPT');
    const synthetic = /^c11111111111111111111111111111111111111111111111111111111110[1-9]$/.test(row.receiptHash);
    if (synthetic && r.reviewStatus !== 'SYNTHETIC_RECEIPT')
      throw Error('SYNTHETIC_RECEIPT_NOT_QUARANTINED');
    items.push({key:row.recordKey, publisher:row.publisher,
      status:r.reviewStatus, synthetic, publicationAuthorized:false,
      note:r.observation});
  }
  const summary = Object.fromEntries([...new Set(items.map(x=>x.status))]
    .map(status=>[status,items.filter(x=>x.status===status).length]));
  return {schema:'dialektik-chile-source-audit-v1',scope:'DEV_STAGED_NOT_LICENSED',
    snapshotSha256:createHash('sha256').update(JSON.stringify(snapshot.records)).digest('hex'),
    total:items.length,states:summary,newsAuthorized:0,dbWrites:0,
    autonomousEvents:0,autonomousContradictions:0,items};
}
if (process.argv[1]?.endsWith('/chile-source-reconciliation.mjs')) {
 const s=JSON.parse(readFileSync('docs/operations/source-audit/chile-staged-snapshot-2026-10-26.json'));
 const r=JSON.parse(readFileSync('docs/operations/source-audit/chile-external-review-2026-10-26.json'));
 const report=audit(s,r);
 mkdirSync('artifacts',{recursive:true});
 writeFileSync('artifacts/chile-source-audit.json',JSON.stringify(report,null,2)+'\n');
 const lines=['# Auditoría Dialektik: Chile', '', 'Estos artículos están en revisión, NO autorizados para publicación.',
 '', '| Estado | Número |', '|---|---:|',
 ...Object.entries(report.states).map(([k,v])=>'| '+k+' | '+v+' |'),
 '', 'Noticias autorizadas: 0. Escrituras en Supabase: 0.',
 'No se importan noticias ni se generan acontecimientos o contradicciones.',
 'Se requiere autorizar cada fuente y finalizar RESTORE-GATE #4.', ''];
 writeFileSync('artifacts/chile-source-audit.md',lines.join('\n'));
 process.stdout.write(JSON.stringify({total:report.total,states:report.states,newsAuthorized:0})+'\n');
}
