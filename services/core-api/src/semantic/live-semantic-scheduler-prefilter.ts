/** Only narrows costly candidate pairs; it never proves two headlines are the same event. */
const generic=new Set(['ante','entre','para','sobre','tras','desde','hacia','durante','segun','dice','afirma','anuncia','anuncian','crisis','financiera','financiero','financieras','financieros','politica','politico','gobierno','presidente','presidenta','ministro','ministra','nuevo','nueva','chile','chilenos','declaraciones','noticias']);
function tokens(text:string):Set<string> {
  const normalized=text.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  return new Set((normalized.match(/[a-z0-9]{4,}/gu) ?? []).filter(token=>!generic.has(token)));
}
export function hasSpecificHeadlineOverlap(left:string,right:string):boolean {
  const a=tokens(left), b=tokens(right); let shared=0;
  for(const token of a) if(b.has(token) && ++shared>=2) return true;
  return false;
}
