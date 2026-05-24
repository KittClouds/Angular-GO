export const GRAPH_RELATION_FAMILY_HSL: Record<string, string> = {
    cooccurrence: '215 10% 62%',
    observation: '188 82% 62%',
    communication: '162 72% 57%',
    approval: '112 72% 55%',
    command: '355 82% 61%',
    family: '338 76% 66%',
    intimacy: '312 76% 64%',
    transfer: '58 94% 56%',
    scenePresence: '18 88% 61%',
    causal: '12 90% 60%',
    temporal: '64 84% 52%',
    relationship: '292 76% 65%',
};

export function relationFamilyFromText(...parts: unknown[]): string | null {
    const text = parts
        .map((part) => String(part || ''))
        .join(' ')
        .toLowerCase()
        .replace(/[_-]+/g, ' ');
    if (/\bco\s*occurs?\b|\bco\s*occurrence\b|\bcooccurs?\b|anchored\s*cooccurrence/.test(text)) return 'cooccurrence';
    if (/\bcauses?\b|\bcausal\b|\bexplains?\b|\bbecause\b|\beffect\b/.test(text)) return 'causal';
    if (/\btemporal\b|\bbefore\b|\bafter\b|\btimeline\b|\btime\s+anchor\b/.test(text)) return 'temporal';
    if (/\bobserves?\b|\bobserved\b|\bwatch(?:ed|es)?\b|\bsaw\b|\bnoticed\b|\blooked\s+at\b/.test(text)) return 'observation';
    if (/\bcomments?\b|\bcommented\b|\bdiscuss(?:es|ed)?\b|\brelease\s+terms\b|\bwarn(?:s|ed|ing)?\b|\bsaid\b|\bsays\b|\btold\b|\basks?\b|\banswers?\b|\breplies?\b|\bspeaks?\b/.test(text)) return 'communication';
    if (/\bapprov(?:es|ed|al)?\b|\baccept(?:s|ed)?\b|\bagree(?:s|d)?\b|\bproceed\b|\bsupports?\b/.test(text)) return 'approval';
    if (/\bcommand\b|\bservice\s+tie\b|\bmilitary\b|\badmiral\b|\bphantom\b/.test(text)) return 'command';
    if (/\bfamily\b|\bfather\b|\bdaughter\b|\bgrandfather\b|\bhouse\s+tie\b/.test(text)) return 'family';
    if (/\bintimate\b|\bclose\s+contact\b|\bkiss\b|\bstood\s+beside\b|\bclose\s+enough\b/.test(text)) return 'intimacy';
    if (/\btransfers?\b|\breceives?\b|\bgave\b|\bhanded\b|\btook\s+it\s+from\b/.test(text)) return 'transfer';
    if (/\bscene\s+presence\b|\bentered\b|\barrived\b|\bcame\s+in\b|\bstood\s+near\b/.test(text)) return 'scenePresence';
    if (/\brelationship\b|\brelation\b|\bgraph\s+fact\b|\bfact\b|\btrusts?\b|\bbond\b|\bfriend\b/.test(text)) return 'relationship';
    return null;
}

export function relationHslFromText(...parts: unknown[]): string | null {
    const family = relationFamilyFromText(...parts);
    return family ? GRAPH_RELATION_FAMILY_HSL[family] || null : null;
}
