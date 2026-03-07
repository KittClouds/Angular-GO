export interface GraptorScopeNote {
  id: string;
  narrativeId: string;
}

export interface GraptorScopeEntity {
  id: string;
  label: string;
  aliases: string[];
  narrativeId?: string;
}

export interface GraptorGraphNode {
  label?: string;
  Label?: string;
}

export function buildScopedCanonicalEntityMap(
  entities: GraptorScopeEntity[],
  notes: GraptorScopeNote[]
): Map<string, GraptorScopeEntity> {
  const scopedNarratives = new Set(
    notes
      .map((note) => note.narrativeId?.trim() || '')
      .filter((narrativeId) => narrativeId.length > 0)
  );

  const allowNarrative = (entity: GraptorScopeEntity): boolean => {
    const narrativeId = entity.narrativeId?.trim() || '';
    if (!narrativeId) return true;
    if (scopedNarratives.size === 0) return false;
    return scopedNarratives.has(narrativeId);
  };

  return new Map(
    entities
      .filter(allowNarrative)
      .map((entity) => [entity.id, entity] as const)
  );
}

export function collectScopedRegistrationNames(
  entityId: string,
  canonicalEntity: GraptorScopeEntity | undefined,
  graphNode: GraptorGraphNode | undefined
): string[] {
  const names = new Set<string>();

  const primaryLabel = canonicalEntity?.label || graphNode?.label || graphNode?.Label || '';
  if (primaryLabel.trim()) {
    names.add(primaryLabel.trim());
  }

  if (canonicalEntity) {
    for (const alias of canonicalEntity.aliases || []) {
      if (typeof alias === 'string' && alias.trim()) {
        names.add(alias.trim());
      }
    }
  }

  if (!names.size && entityId.trim()) {
    names.add(entityId.trim());
  }

  return [...names];
}
