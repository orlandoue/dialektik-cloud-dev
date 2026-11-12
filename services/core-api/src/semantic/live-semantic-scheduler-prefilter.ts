/** Only narrows costly candidate pairs; it never proves two headlines are the same event. */
const generic=new Set(['ante','entre','para','sobre','tras','desde','hacia','durante','segun','contra','llego','llega','hora','programa','radio','television','dice','afirma','anuncia','anuncian','responde','respuesta','critica','criticas','oposicion','derecha','izquierda','crisis','financiera','financiero','financieras','financieros','politica','politico','gobierno','presidente','presidenta','ministro','ministra','nuevo','nueva','chile','chilenos','declaraciones','noticias']);
function tokens(text:string):Set<string> {
  const normalized=text.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  return new Set((normalized.match(/[a-z0-9]{4,}/gu) ?? []).filter(token=>!generic.has(token)));
}
export function hasSpecificHeadlineOverlap(left:string,right:string):boolean {
  return specificOverlap(left,right)>=2;
}

/** Number of specific (non-generic, 4+ letter) words two texts share. */
export function specificOverlap(left:string,right:string):number {
  const a=tokens(left), b=tokens(right); let shared=0;
  for(const token of a) if(b.has(token)) shared++;
  return shared;
}

/** Minimum shared specific words across headline and excerpt of a pair. */
export const MIN_PAIR_TEXT_OVERLAP=3;

/**
 * Stricter pre-model evidence that two items cover the same case: two
 * specific headline words and three across headline plus excerpt.
 */
export function hasStrongPairOverlap(leftHeadline:string,leftExcerpt:string,rightHeadline:string,rightExcerpt:string):boolean {
  return hasSpecificHeadlineOverlap(leftHeadline,rightHeadline) &&
    specificOverlap(`${leftHeadline} ${leftExcerpt}`,`${rightHeadline} ${rightExcerpt}`)>=MIN_PAIR_TEXT_OVERLAP;
}

/**
 * Sports signal shared by the pre-model filter and the promotion guard.
 * «Partido» alone is ambiguous (a political party), so it only counts with
 * a sports context word.
 */
export function isSportsText(text:string):boolean {
  const value=text.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase();
  if (/\b(?:futbolista\w*|futbol\w*|torneo\w*|campeonato\w*|gol(?:es|eador\w*)?)\b/u.test(value)) return true;
  return /\bpartido\w*\b/u.test(value) &&
    /\b(?:equipo\w*|club\w*|cancha\w*|estadio\w*|seleccion\w*|liga|copa|hincha\w*|entrenador\w*|tecnico|marcador|delantero\w*|arquero\w*|goleador\w*)\b/u.test(value);
}

/** Ranking signal only; it does not prove conflict or permit publication. */
export function controversyScore(...texts: string[]): number {
  const text = texts.join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
  const strong = /\b(?:cuestion\w*|rechaz\w*|acus\w*|desmient\w*|respond\w*|replic\w*|polemic\w*|critic\w*|querell\w*|denunci\w*|defens\w*|imputad\w*)\b/gu;
  const context = /\b(?:oposicion|gobierno|fiscalia|corte|investigacion)\b/gu;
  return new Set(text.match(strong) ?? []).size * 3 + new Set(text.match(context) ?? []).size;
}
