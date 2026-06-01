import type { Edge, RegisteredEntity } from '../../lib/registry';
import type { GraphModelV2Atom, GraphModelV2FactRole } from '../../graph-rebuild/graph-model-v2';
import type { GraphRebuildAdjudicationStatus, GraphRebuildSnapshot } from '../../graph-rebuild/graph-rebuild-snapshot';

export type EntityGraphFactSheetRelationSource =
  | 'registry'
  | 'compilerFact'
  | 'compilerBundle'
  | 'factSheetCuration';

export type EntityGraphFactSheetDirection = 'outgoing' | 'incoming' | 'related';

export interface EntityGraphFactSheetEntity {
  id: string;
  label: string;
  kind?: string;
}

export interface EntityGraphFactSheetRelationRow {
  id: string;
  source: EntityGraphFactSheetRelationSource;
  sourceRecordId: string;
  relationType: string;
  family?: string;
  direction: EntityGraphFactSheetDirection;
  sourceEntityId: string;
  targetEntityId?: string;
  targetLabel: string;
  targetKind?: string;
  status: GraphRebuildAdjudicationStatus | 'prepared' | 'accepted';
  confidence: number;
  evidenceCount: number;
  evidenceIds: string[];
  note?: string;
  network: boolean;
}

export interface EntityGraphFactSheetSummary {
  total: number;
  committed: number;
  promoted: number;
  review: number;
  staged: number;
  network: number;
  evidenceAnchors: number;
}

export interface EntityGraphFactSheetView {
  entityId: string;
  scopeId: string;
  relationships: EntityGraphFactSheetRelationRow[];
  summary: EntityGraphFactSheetSummary;
}

export interface EntityGraphFactSheetViewInput {
  entity: EntityGraphFactSheetEntity;
  scopeId?: string;
  registryEntities?: RegisteredEntity[];
  registryEdges?: Edge[];
  snapshot?: GraphRebuildSnapshot | null;
  attributes?: Record<string, unknown>;
}

interface StewardRelation {
  id: string;
  type?: string;
  targetEntityId?: string;
  targetLabel?: string;
  note?: string;
  createdAt?: number;
}

const STEWARD_RELATION_KEY = 'stewardRelations';
const OUTGOING_ROLES = new Set(['source', 'subject', 'actor', 'speaker', 'cause']);
const INCOMING_ROLES = new Set(['target', 'object', 'effect', 'listener']);
const NETWORK_RELATION_TYPES = new Set([
  'affiliated_with',
  'allied_with',
  'belongs_to',
  'leads',
  'located_in',
  'member_of',
  'part_of',
  'serves',
]);
const NETWORK_ENTITY_KINDS = new Set(['FACTION', 'GROUP', 'NETWORK', 'ORGANIZATION', 'ORG']);

export function buildEntityGraphFactSheetView(
  input: EntityGraphFactSheetViewInput,
): EntityGraphFactSheetView {
  const entities = new Map((input.registryEntities || []).map((entity) => [entity.id, entity]));
  const rows: EntityGraphFactSheetRelationRow[] = [];
  const entityId = input.entity.id;

  for (const edge of input.registryEdges || []) {
    rows.push(registryEdgeRow(edge, entityId, entities));
  }

  rows.push(...compilerFactRows(input.snapshot, input.entity, entities));
  rows.push(...compilerBundleRows(input.snapshot, input.entity, entities));
  rows.push(...stewardRelationRows(input.attributes, input.entity, entities));

  const relationships = dedupeRows(rows)
    .filter((row) => row.sourceEntityId === entityId)
    .sort(compareRows);

  return {
    entityId,
    scopeId: input.scopeId || 'global',
    relationships,
    summary: summarizeRows(relationships),
  };
}

function registryEdgeRow(
  edge: Edge,
  entityId: string,
  entities: Map<string, RegisteredEntity>,
): EntityGraphFactSheetRelationRow {
  const outgoing = edge.sourceId === entityId;
  const targetId = outgoing ? edge.targetId : edge.sourceId;
  const target = entities.get(targetId);
  const evidenceIds = stringArray((edge.attributes || {})['evidenceAnchorIds']);

  return {
    id: `registry:${edge.id}`,
    source: 'registry',
    sourceRecordId: edge.id,
    relationType: edge.type || 'relates_to',
    family: relationFamily(edge.type),
    direction: outgoing ? 'outgoing' : 'incoming',
    sourceEntityId: entityId,
    targetEntityId: targetId,
    targetLabel: target?.label || targetId,
    targetKind: target?.kind,
    status: 'accepted',
    confidence: clampConfidence(edge.confidence),
    evidenceCount: evidenceIds.length,
    evidenceIds,
    note: edge.sourceNote,
    network: isNetworkRelation(edge.type, target?.kind),
  };
}

function compilerFactRows(
  snapshot: GraphRebuildSnapshot | null | undefined,
  entity: EntityGraphFactSheetEntity,
  entities: Map<string, RegisteredEntity>,
): EntityGraphFactSheetRelationRow[] {
  const model = snapshot?.graphModelV2;
  if (!model) return [];

  const atoms = new Map(model.atoms.map((atom) => [atom.id, atom]));
  const rolesByFact = groupRoles(model.roles);
  const rows: EntityGraphFactSheetRelationRow[] = [];

  for (const fact of model.facts) {
    const roles = rolesByFact.get(fact.id) || [];
    const currentRoles = roles.filter((role) => atomMatchesEntity(atoms.get(role.targetAtomId), entity.id));
    if (!currentRoles.length) continue;

    const counterpart = counterpartAtom(roles, atoms, entity.id);
    const targetEntity = counterpart?.kind === 'entity' ? entities.get(counterpart.sourceId) : undefined;
    const targetId = counterpart?.kind === 'entity' ? counterpart.sourceId : counterpart?.sourceId;
    const currentRole = currentRoles[0]?.role || 'subject';

    rows.push({
      id: `compiler-fact:${fact.id}`,
      source: 'compilerFact',
      sourceRecordId: fact.sourceRecordId || fact.id,
      relationType: fact.relationType || fact.family,
      family: fact.family,
      direction: roleDirection(currentRole),
      sourceEntityId: entity.id,
      targetEntityId: targetId,
      targetLabel: targetEntity?.label || counterpart?.label || fact.relationType || fact.family,
      targetKind: targetEntity?.kind || counterpart?.kind,
      status: fact.status,
      confidence: clampConfidence(fact.confidence),
      evidenceCount: fact.evidenceIds.length,
      evidenceIds: fact.evidenceIds,
      network: isNetworkRelation(fact.relationType, targetEntity?.kind),
    });
  }

  return rows;
}

function compilerBundleRows(
  snapshot: GraphRebuildSnapshot | null | undefined,
  entity: EntityGraphFactSheetEntity,
  entities: Map<string, RegisteredEntity>,
): EntityGraphFactSheetRelationRow[] {
  const model = snapshot?.graphModelV2;
  if (!model) return [];

  const atoms = new Map(model.atoms.map((atom) => [atom.id, atom]));
  const bundleById = new Map(model.bundles.map((bundle) => [bundle.id, bundle]));
  const rows: EntityGraphFactSheetRelationRow[] = [];

  for (const edge of model.projectionEdges) {
    if (!edge.sourceBundleId) continue;
    const bundle = bundleById.get(edge.sourceBundleId);
    const atom = atoms.get(edge.targetId);
    if (!bundle || !atomMatchesEntity(atom, entity.id)) continue;

    const relationTarget = relationTargetFromProjection(model.projectionEdges, atoms, edge.sourceBundleId, entity.id);
    const targetEntity = relationTarget?.kind === 'entity' ? entities.get(relationTarget.sourceId) : undefined;

    rows.push({
      id: `compiler-bundle:${bundle.id}`,
      source: 'compilerBundle',
      sourceRecordId: bundle.sourceRecordId || bundle.id,
      relationType: bundle.relationType || bundle.family,
      family: bundle.family,
      direction: 'related',
      sourceEntityId: entity.id,
      targetEntityId: relationTarget?.sourceId,
      targetLabel: targetEntity?.label || relationTarget?.label || bundle.relationType || bundle.family,
      targetKind: targetEntity?.kind || relationTarget?.kind,
      status: bundle.status,
      confidence: clampConfidence(bundle.confidence),
      evidenceCount: bundle.evidenceIds.length,
      evidenceIds: bundle.evidenceIds,
      network: isNetworkRelation(bundle.relationType, targetEntity?.kind),
    });
  }

  return rows;
}

function stewardRelationRows(
  attributes: Record<string, unknown> | undefined,
  entity: EntityGraphFactSheetEntity,
  entities: Map<string, RegisteredEntity>,
): EntityGraphFactSheetRelationRow[] {
  const values = Array.isArray(attributes?.[STEWARD_RELATION_KEY])
    ? attributes?.[STEWARD_RELATION_KEY] as unknown[]
    : [];

  return values.filter(isStewardRelation).map((relation) => {
    const target = relation.targetEntityId ? entities.get(relation.targetEntityId) : undefined;
    const relationType = relation.type || 'relates_to';
    return {
      id: `curation:${relation.id}`,
      source: 'factSheetCuration',
      sourceRecordId: relation.id,
      relationType,
      family: relationFamily(relationType),
      direction: 'outgoing',
      sourceEntityId: entity.id,
      targetEntityId: relation.targetEntityId,
      targetLabel: target?.label || relation.targetLabel || relation.targetEntityId || 'Unresolved target',
      targetKind: target?.kind,
      status: 'prepared',
      confidence: 1,
      evidenceCount: relation.note ? 1 : 0,
      evidenceIds: [],
      note: relation.note,
      network: isNetworkRelation(relationType, target?.kind),
    };
  });
}

function groupRoles(roles: GraphModelV2FactRole[]): Map<string, GraphModelV2FactRole[]> {
  const grouped = new Map<string, GraphModelV2FactRole[]>();
  for (const role of roles) {
    grouped.set(role.factId, [...(grouped.get(role.factId) || []), role]);
  }
  return grouped;
}

function atomMatchesEntity(atom: GraphModelV2Atom | undefined, entityId: string): boolean {
  return atom?.kind === 'entity' && atom.sourceId === entityId;
}

function counterpartAtom(
  roles: GraphModelV2FactRole[],
  atoms: Map<string, GraphModelV2Atom>,
  entityId: string,
): GraphModelV2Atom | undefined {
  return roles
    .map((role) => atoms.get(role.targetAtomId))
    .find((atom) => !!atom && atom.kind !== 'evidenceAnchor' && atom.sourceId !== entityId);
}

function relationTargetFromProjection(
  projectionEdges: NonNullable<GraphRebuildSnapshot['graphModelV2']>['projectionEdges'],
  atoms: Map<string, GraphModelV2Atom>,
  bundleId: string,
  entityId: string,
): GraphModelV2Atom | undefined {
  return projectionEdges
    .filter((edge) => edge.sourceBundleId === bundleId)
    .map((edge) => atoms.get(edge.targetId))
    .find((atom) => !!atom && atom.kind !== 'evidenceAnchor' && atom.sourceId !== entityId);
}

function roleDirection(role: string): EntityGraphFactSheetDirection {
  if (OUTGOING_ROLES.has(role)) return 'outgoing';
  if (INCOMING_ROLES.has(role)) return 'incoming';
  return 'related';
}

function compareRows(left: EntityGraphFactSheetRelationRow, right: EntityGraphFactSheetRelationRow): number {
  return sourceRank(left.source) - sourceRank(right.source)
    || statusRank(right.status) - statusRank(left.status)
    || right.confidence - left.confidence
    || left.targetLabel.localeCompare(right.targetLabel)
    || left.relationType.localeCompare(right.relationType);
}

function dedupeRows(rows: EntityGraphFactSheetRelationRow[]): EntityGraphFactSheetRelationRow[] {
  const seen = new Set<string>();
  const deduped: EntityGraphFactSheetRelationRow[] = [];
  for (const row of rows) {
    const key = [
      row.source,
      row.sourceEntityId,
      row.targetEntityId || row.targetLabel.toLowerCase(),
      row.relationType,
      row.status,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function summarizeRows(rows: EntityGraphFactSheetRelationRow[]): EntityGraphFactSheetSummary {
  const evidenceIds = new Set<string>();
  for (const row of rows) {
    for (const evidenceId of row.evidenceIds) evidenceIds.add(evidenceId);
  }
  return {
    total: rows.length,
    committed: rows.filter((row) => row.source === 'registry').length,
    promoted: rows.filter((row) => row.source === 'compilerFact' && row.status === 'accepted').length,
    review: rows.filter((row) => row.status === 'review').length,
    staged: rows.filter((row) => row.status === 'prepared').length,
    network: rows.filter((row) => row.network).length,
    evidenceAnchors: evidenceIds.size,
  };
}

function isNetworkRelation(relationType: string | undefined, targetKind: string | undefined): boolean {
  return NETWORK_RELATION_TYPES.has(normalizeLabel(relationType))
    || NETWORK_ENTITY_KINDS.has(String(targetKind || '').toUpperCase());
}

function relationFamily(relationType: string | undefined): string {
  const normalized = normalizeLabel(relationType);
  if (normalized.includes('family') || normalized.includes('kin')) return 'family';
  if (normalized.includes('caus')) return 'causal';
  if (normalized.includes('time') || normalized.includes('before') || normalized.includes('after')) return 'temporal';
  if (normalized.includes('observe') || normalized.includes('see')) return 'observation';
  if (normalized.includes('speak') || normalized.includes('tell')) return 'communication';
  if (normalized.includes('co_occurs')) return 'cooccurrence';
  return 'relationship';
}

function sourceRank(source: EntityGraphFactSheetRelationSource): number {
  switch (source) {
    case 'registry': return 0;
    case 'compilerFact': return 1;
    case 'compilerBundle': return 2;
    case 'factSheetCuration': return 3;
  }
}

function statusRank(status: EntityGraphFactSheetRelationRow['status']): number {
  if (status === 'accepted') return 3;
  if (status === 'review') return 2;
  if (status === 'prepared') return 1;
  return 0;
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(1, typeof value === 'number' && Number.isFinite(value) ? value : 0));
}

function normalizeLabel(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isStewardRelation(value: unknown): value is StewardRelation {
  const relation = value as StewardRelation;
  return !!relation && typeof relation.id === 'string';
}
