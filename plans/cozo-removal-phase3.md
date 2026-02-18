# CozoDB Removal - Phase 3 Plan

## Overview

Phase 3 removes all CozoDB code from the codebase. No migration is needed - the GoKitt/SQLite backend is now the sole persistence layer. This document identifies all files to remove and files that need updates to break CozoDB dependencies.

## Files to DELETE

### Core CozoDB Directory
```
src/app/lib/cozo/
├── cozo.service.ts
├── db.ts                      # CozoDb WASM initialization
├── narrativeScope.ts
├── types.ts
├── api/
│   └── graphBuilder.ts
├── content/
│   ├── CalendarRepo.ts
│   ├── ContentRepo.test.ts
│   ├── ContentRepo.ts
│   ├── ContentSchema.ts
│   ├── ContentTypes.ts
│   ├── EntityMetadataService.ts
│   └── index.ts
├── fts/
│   ├── FtsSchema.ts
│   ├── FtsService.spec.ts
│   └── FtsService.ts
├── graph/
│   ├── causalLinks.ts
│   ├── cooccurrenceBuilder.ts
│   ├── folder-network-queries.ts
│   ├── GraphHotCache.test.ts
│   ├── GraphHotCache.ts
│   ├── GraphRegistry.ts
│   ├── GraphSchema.ts
│   ├── index.ts
│   ├── scopeMerger.ts
│   ├── windowCooccurrence.ts
│   └── adapters/
│       ├── EntityRegistryAdapter.ts
│       ├── RelationshipRegistryAdapter.ts
│       └── types.ts
├── memory/
│   ├── EpisodeLogService.ts
│   ├── index.ts
│   └── MemoryRecallService.ts
├── persistence/
│   ├── BackupService.ts
│   ├── cozo-opfs-core.ts
│   ├── cozo-opfs.worker.ts
│   ├── CozoPersistenceService.ts
│   └── index.ts
├── schema/
│   ├── layer2-crossdoc.test.ts
│   ├── layer2-crossdoc.ts
│   ├── layer2-folder-hierarchy.ts
│   ├── layer2-network-instance.ts
│   ├── layer2-network-membership.ts
│   ├── layer2-network-relationship.ts
│   ├── layer2-span-model.ts
│   ├── layer2-unified-edges.ts
│   ├── layer3-raptor.ts
│   └── layer4-memory.ts
└── utils/
    ├── ids.ts
    ├── index.ts
    └── types.ts
```

### Bridge Layer (Cozo-specific)
```
src/app/lib/bridge/
├── CozoFieldMapper.test.ts    # DELETE
├── CozoFieldMapper.ts          # DELETE
└── CozoHydrator.ts             # DELETE
```

**KEEP:**
- `GoSqliteCozoBridge.ts` - Rename to `GoSqliteBridge.ts`, remove Cozo imports
- `index.ts` - Update exports

### Storage
```
src/app/lib/storage/
└── cozoBootCache.ts            # DELETE (if exists)
```

### Mocks
```
src/app/__mocks__/
└── cozo-lib-wasm.ts            # DELETE
```

## Files to UPDATE

### 1. `src/app/services/graph-viz.service.ts`
**Current imports:**
```typescript
import { graphRegistry } from '../lib/cozo/graph';
```
**Action:** Remove import, use `KnowledgeService` instead

### 2. `src/app/services/gokitt.service.ts`
**Current imports:**
```typescript
import { graphRegistry, type RelationshipProvenance } from '../lib/cozo/graph';
import type { EntityKind } from '../lib/cozo/utils';
```
**Action:** 
- Remove `graphRegistry` import
- Move `EntityKind` type to `src/app/lib/types/` or define locally
- Move `RelationshipProvenance` type locally

### 3. `src/app/pages/graph/graph-page.component.ts`
**Current imports:**
```typescript
import { graphRegistry } from '../../lib/cozo/graph';
```
**Action:** Remove import, use `KnowledgeService` (already done in Phase 1)

### 4. `src/app/lib/services/semantic-search.service.ts`
**Current imports:**
```typescript
import { CozoService } from '../cozo/cozo.service';
import { RAPTOR_QUERIES } from '../cozo/schema/layer3-raptor';
```
**Action:** Remove imports, use `GoKittService` for search

### 5. `src/app/lib/services/projection-cache.service.ts`
**Current imports:**
```typescript
import type { CozoSpan } from '../cozo/schema/layer2-span-model';
```
**Action:** Define `Span` type locally or import from GoKitt models

### 6. `src/app/lib/services/llm-relation-extractor.service.ts`
**Current imports:**
```typescript
import { type EntityKind, isEntityKind } from '../cozo/utils';
```
**Action:** Move `EntityKind` and `isEntityKind` to `src/app/lib/types/entity.ts`

### 7. `src/app/lib/services/llm-entity-extractor.service.ts`
**Current imports:**
```typescript
import { type EntityKind, isEntityKind } from '../cozo/utils';
```
**Action:** Same as above - move to shared types

### 8. `src/app/lib/services/embedding-queue.service.ts`
**Current imports:**
```typescript
import { CozoService } from '../cozo/cozo.service';
import { RAPTOR_QUERIES, RaptorPayload } from '../cozo/schema/layer3-raptor';
```
**Action:** Remove imports, use `GoKittService`

### 9. `src/app/lib/rlm/services/query-runner.service.ts`
**Current imports:**
```typescript
import { cozoDb } from '../../cozo/db';
import { recordAction } from '../../cozo/memory/EpisodeLogService';
```
**Action:** 
- Remove `cozoDb` import (already not used after Phase 1)
- Create new `EpisodeLogService` in `src/app/lib/services/` that uses GoKitt

### 10. `src/app/lib/rlm/services/rlm-loop.service.ts`
**Current imports:**
```typescript
import { recordAction } from '../../cozo/memory/EpisodeLogService';
import { ftsService } from '../../cozo/fts/FtsService';
```
**Action:**
- Replace `recordAction` with GoKitt-based implementation
- Replace `ftsService` with GoKitt search methods

### 11. `src/app/lib/rlm/services/workspace-ops.service.ts`
**Current imports:**
```typescript
import { cozoDb } from '../../cozo/db';
import { recordAction } from '../../cozo/memory/EpisodeLogService';
```
**Action:** Same as query-runner.service.ts

### 12. `src/app/lib/rlm/services/rlm-loop.service.spec.ts`
**Current imports:**
```typescript
import { recordAction } from '../../cozo/memory/EpisodeLogService';
import { ftsService } from '../../cozo/fts/FtsService';
```
**Action:** Update imports to use new locations

### 13. `src/app/lib/operations.ts`
**Current imports:**
```typescript
import { recordAction } from './cozo/memory/EpisodeLogService';
```
**Action:** Update import path

### 14. `src/app/lib/bridge/GoSqliteCozoBridge.ts`
**Current imports:**
```typescript
import { DexieToCozo, CozoQueries } from './CozoFieldMapper';
import { cozoDb } from '../cozo/db';
```
**Action:**
- Remove Cozo imports
- Rename file to `GoSqliteBridge.ts`
- Remove all CozoDB-related methods

### 15. `src/app/components/fact-sheets/fact-sheet-container/fact-sheet-container.component.ts`
**Current imports:**
```typescript
import { graphRegistry } from '../../../lib/cozo/graph/GraphRegistry';
```
**Action:** Use `KnowledgeService` or `GoKittService` instead

## Types to Preserve

These types need to be moved to new locations before deleting CozoDB:

### EntityKind (from `cozo/utils/types.ts`)
```typescript
// Move to: src/app/lib/types/entity.ts
export type EntityKind = 
    | 'Person' 
    | 'Place' 
    | 'Organization' 
    | 'Event' 
    | 'Concept' 
    | 'Object'
    | 'Work';

export function isEntityKind(value: string): value is EntityKind {
    return ['Person', 'Place', 'Organization', 'Event', 'Concept', 'Object', 'Work'].includes(value);
}
```

### RelationshipProvenance (from `cozo/graph/GraphRegistry.ts`)
```typescript
// Move to: src/app/lib/types/relationship.ts
export interface RelationshipProvenance {
    sourceNoteId?: string;
    extractionMethod?: 'user' | 'llm' | 'heuristic';
    confidence?: number;
    createdAt?: number;
}
```

### Span Types (from `cozo/schema/layer2-span-model.ts`)
```typescript
// Move to: src/app/lib/types/span.ts
export interface Span {
    id: string;
    noteId: string;
    startOffset: number;
    endOffset: number;
    text: string;
    kind: string;
    createdAt: number;
}
```

## NPM Dependencies to Remove

```json
// package.json
{
  "dependencies": {
    "cozo-lib-wasm": "^0.0.x"  // REMOVE
  }
}
```

## Execution Order

1. **Create shared types** - Move `EntityKind`, `RelationshipProvenance`, `Span` to `src/app/lib/types/`
2. **Update imports** - Update all files that import from CozoDB to use new type locations
3. **Update RLM services** - Replace `cozoDb`, `recordAction`, `ftsService` with GoKitt equivalents
4. **Update bridge** - Clean up `GoSqliteCozoBridge.ts` and rename
5. **Delete CozoDB directory** - Remove `src/app/lib/cozo/`
6. **Delete bridge files** - Remove `CozoFieldMapper.ts`, `CozoHydrator.ts`
7. **Remove npm dependency** - Remove `cozo-lib-wasm` from package.json
8. **Verify build** - Run `npm run build` to confirm no errors

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Missing type imports | Create types first, update imports incrementally |
| RLM service breakage | RLM already has GoKitt integration path via `Go_RLM.md` |
| Graph visualization | `KnowledgeService` already provides graph data |
| FTS functionality | GoKitt has `SearchNotes` method for text search |

## Verification Checklist

- [ ] TypeScript compiles without errors
- [ ] No CozoDB imports remain in codebase
- [ ] `npm run build` succeeds
- [ ] Application starts without errors
- [ ] Graph view displays entities
- [ ] Entity extraction works
- [ ] Search functionality works
