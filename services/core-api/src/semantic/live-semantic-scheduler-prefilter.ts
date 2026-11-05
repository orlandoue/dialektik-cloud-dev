/** Only narrows costly candidate pairs; it never proves two headlines are the same event. */
const generic=new Set(['ante','entre','para','sobre','tras','desde','hacia','durante','segun','contra','llego','llega','hora','programa','radio','television','dice','afirma','anuncia','anuncian','responde','respuesta','critica','criticas','oposicion','derecha','izquierda','crisis','financiera','financiero','financieras','financieros','politica','politico','gobierno','presidente','presidenta','ministro','ministra','nuevo','nueva','chile','chilenos','declaraciones','noticias']);
function tokens(text:string):Set<string> {
  const normalized=text.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  return new Set((normalized.match(/[a-z0-9]{4,}/gu) ?? []).filter(token=>!generic.has(token)));
}
export function hasSpecificHeadlineOverlap(left:string,right:string):boolean {
  const a=tokens(left), b=tokens(right); let shared=0;
  for(const token of a) if(b.has(token) && ++shared>=2) return true;
  return false;
}

/** Ranking signal only; it does not prove conflict or permit publication. */
export function controversyScore(...texts: string[]): number {
  const text = texts.join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const strong = /\b(?:cuestion\w*|rechaz\w*|acus\w*|desmient\w*|respond\w*|replic\w*|polemic\w*|critic\w*|querell\w*|denunci\w*|defens\w*|imputad\w*)\b/gu;
  const context = /\b(?:oposicion|gobierno|fiscalia|corte|investigacion)\b/gu;
  return new Set(text.match(strong) ?? []).size * 3 + new Set(text.match(context) ?? []).size;
}
