import type { DecorationSpan } from '../lib/Scanner/types';
import type { CentralRegistry } from '../lib/registry';

const ENTITY_SPAN_TYPES = new Set<DecorationSpan['type']>(['entity', 'entity_ref', 'entity_implicit']);

export function filterCachedEntitySpans(
    spans: DecorationSpan[],
    registry: Pick<CentralRegistry, 'getEntityById' | 'findEntityByLabel'>
): DecorationSpan[] {
    return spans.filter(span => {
        if (!ENTITY_SPAN_TYPES.has(span.type)) {
            return true;
        }

        const hasResolvedId = !!span.entityId && !!registry.getEntityById(span.entityId);
        const hasResolvedLabel = !!span.label && !!registry.findEntityByLabel(span.label);
        return hasResolvedId || hasResolvedLabel;
    });
}
