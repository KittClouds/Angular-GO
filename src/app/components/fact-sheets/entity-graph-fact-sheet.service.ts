import { Injectable, inject } from '@angular/core';

import { GraphRebuildService } from '../../graph-rebuild/graph-rebuild.service';
import { smartGraphRegistry } from '../../lib/registry';
import {
  buildEntityGraphFactSheetView,
  type EntityGraphFactSheetEntity,
  type EntityGraphFactSheetView,
} from './entity-graph-fact-sheet';

@Injectable({ providedIn: 'root' })
export class EntityGraphFactSheetService {
  private readonly graphRebuild = inject(GraphRebuildService);

  async loadView(
    entity: EntityGraphFactSheetEntity,
    contextId: string,
    attributes: Record<string, unknown>,
  ): Promise<EntityGraphFactSheetView> {
    const scopeId = graphFactSheetScopeId(contextId);
    const liveSnapshot = this.graphRebuild.snapshot();
    const snapshot = liveSnapshot?.scopeId === scopeId
      ? liveSnapshot
      : await this.graphRebuild.loadPersistedSnapshot(scopeId).catch(() => null);

    return buildEntityGraphFactSheetView({
      entity,
      scopeId,
      attributes,
      snapshot,
      registryEntities: smartGraphRegistry.getAllEntities(),
      registryEdges: smartGraphRegistry.getEdgesForEntity(entity.id),
    });
  }
}

export function graphFactSheetScopeId(contextId: string | null | undefined): string {
  const value = String(contextId || '').trim();
  if (!value || value === 'vault:global') return 'global';
  return value.startsWith('vault:') ? value.slice('vault:'.length) || 'global' : value;
}
