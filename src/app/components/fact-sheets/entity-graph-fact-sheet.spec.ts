import { describe, expect, it } from 'vitest';

import type { Edge, RegisteredEntity } from '../../lib/registry';
import type { GraphModelV2Snapshot } from '../../graph-rebuild/graph-model-v2';
import type { GraphRebuildSnapshot } from '../../graph-rebuild/graph-rebuild-snapshot';
import { buildEntityGraphFactSheetView } from './entity-graph-fact-sheet';

const kai = entity('entity-kai', 'Kai', 'CHARACTER');
const rift = entity('entity-rift', 'Rift', 'CHARACTER');
const redMesa = entity('network-red-mesa', 'Red Mesa', 'NETWORK');

describe('buildEntityGraphFactSheetView', () => {
  it('surfaces committed registry edges as graph truth', () => {
    const view = buildEntityGraphFactSheetView({
      entity: kai,
      registryEntities: [kai, redMesa],
      registryEdges: [{
        id: 'edge-member',
        sourceId: kai.id,
        targetId: redMesa.id,
        type: 'member_of',
        confidence: 0.94,
        provenance: 'manual',
      } satisfies Edge],
    });

    expect(view.summary).toMatchObject({ total: 1, committed: 1, network: 1 });
    expect(view.relationships[0]).toMatchObject({
      source: 'registry',
      relationType: 'member_of',
      targetLabel: 'Red Mesa',
      status: 'accepted',
    });
  });

  it('projects compiler facts through roles and evidence anchors', () => {
    const view = buildEntityGraphFactSheetView({
      entity: kai,
      registryEntities: [kai, rift],
      snapshot: snapshotWithModel(modelWithFact()),
    });

    expect(view.summary).toMatchObject({ total: 1, review: 1, evidenceAnchors: 1 });
    expect(view.relationships[0]).toMatchObject({
      source: 'compilerFact',
      relationType: 'observes',
      direction: 'outgoing',
      targetLabel: 'Rift',
      confidence: 0.68,
    });
  });

  it('keeps steward relations staged instead of promoting them to truth', () => {
    const view = buildEntityGraphFactSheetView({
      entity: kai,
      registryEntities: [kai, redMesa],
      attributes: {
        stewardRelations: [{
          id: 'curated-1',
          type: 'member_of',
          targetEntityId: redMesa.id,
          targetLabel: redMesa.label,
          note: 'Manual story canon.',
          createdAt: 1,
        }],
      },
    });

    expect(view.summary).toMatchObject({ total: 1, staged: 1, network: 1 });
    expect(view.relationships[0]).toMatchObject({
      source: 'factSheetCuration',
      status: 'prepared',
      targetLabel: 'Red Mesa',
      evidenceCount: 1,
    });
  });
});

function entity(id: string, label: string, kind: string): RegisteredEntity {
  return {
    id,
    label,
    kind: kind as RegisteredEntity['kind'],
    aliases: [],
    firstNote: 'note-1',
    mentionsByNote: new Map(),
    totalMentions: 0,
    lastSeenDate: new Date(0),
    createdAt: new Date(0),
    createdBy: 'user',
    registeredAt: 0,
  };
}

function modelWithFact(): GraphModelV2Snapshot {
  return {
    schemaVersion: 'phoenix-graph-model/v2',
    sourceSnapshotId: 'snapshot-1',
    builtAt: 1,
    atoms: [
      atom('atom:kai', kai.id, kai.label),
      atom('atom:rift', rift.id, rift.label),
    ],
    laneRoots: [],
    bundles: [],
    facts: [{
      id: 'fact-1',
      family: 'observation',
      relationType: 'observes',
      lane: 'relationship_fact',
      status: 'review',
      confidence: 0.68,
      evidenceIds: ['evidence-1'],
      sourceRecordId: 'relationship-1',
    }],
    roles: [
      { factId: 'fact-1', role: 'source', targetAtomId: 'atom:kai', confidence: 0.68 },
      { factId: 'fact-1', role: 'target', targetAtomId: 'atom:rift', confidence: 0.68 },
      { factId: 'fact-1', role: 'evidence', targetAtomId: 'atom:evidence-1', confidence: 0.68 },
    ],
    styleTags: [],
    projectionEdges: [],
    counters: {
      atoms: 2,
      laneRoots: 0,
      bundles: 0,
      facts: 1,
      roles: 3,
      styleTags: 0,
      projectionEdges: 0,
      stagedCooccurrenceBundles: 0,
      weakCooccurrenceFacts: 0,
      hyperedgeFacts: 0,
    },
  };
}

function atom(id: string, sourceId: string, label: string) {
  return {
    id,
    kind: 'entity' as const,
    sourceId,
    label,
    entityKind: 'CHARACTER',
    evidenceIds: [],
  };
}

function snapshotWithModel(model: GraphModelV2Snapshot): GraphRebuildSnapshot {
  return { graphModelV2: model } as GraphRebuildSnapshot;
}
