# Refactoring Frontend Services to use Go/WASM Persistence

## Goal Description
Refactor `NetworkService`, `FactSheetService`, and `DiscoveryStore` to persist data to the SQLite backend via the newly exposed Go/WASM API (`GoKittService`). This ensures data parity between the frontend (Dexie/UI) and the backend (SQLite/CozoDB parity structures).

## User Review Required
> [!IMPORTANT]
> **Dual-Write Strategy**: To ensure a "safe seamless process", we will implement a **Dual-Write** strategy. Services will continue to write to Dexie (for immediate UI reactivity via `liveQuery`) but will *also* write to GoKitt (SQLite). Reads for the UI will largely remain from Dexie for now, unless specific "Backend View" features are requested. This minimizes risk of breaking the UI while populating the backend.

> [!WARNING]
> **Data Synchronization**: Initial state might differ between Dexie and SQLite. We are assuming the SQLite store is initialized or empty. A one-time "Sync to Backend" might be needed later, but for now we focus on *new* writes going to both.

## Proposed Changes

### [Services] Persistence Layer Refactor

#### [MODIFY] [NetworkService.ts](file:///c:/Users/shuga/1kittroot/1code/Angular-build/src/app/lib/services/network.service.ts)
*   Inject `GoKittService`.
*   Update `createInstance`, `updateInstance`, `deleteInstance` to call corresponding `goKitt.storeUpsertNetworkInstance`, etc.
*   Update `createRelationship`, `updateRelationship`, `deleteRelationship` to call `goKitt.storeUpsertNetworkRelationship`, etc.
*   Update `addEntityToNetwork`, `removeEntityFromNetwork` to call `goKitt.storeUpsertNetworkMembership`.

#### [MODIFY] [FactSheetService.ts](file:///c:/Users/shuga/1kittroot/1code/Angular-build/src/app/components/fact-sheets/fact-sheet.service.ts)
*   Inject `GoKittService`.
*   Update `setAttribute` to call `goKitt.storeUpsertEntityCard`.
    *   *Note*: `EntityCard` in Go maps to `EntityMetadata` in some ways but is specific to UI cards. We need to ensure we are saving the *card configuration* if that's what `storeUpsertEntityCard` does, or general metadata.
    *   *Correction*: `store.EntityCard` (Go) seems to match the UI's `FactSheetCardSchema` or specific card instances per entity?
    *   *Check*: `models.go` has `EntityCard` struct with `EntityID`, `CardID`, `Name`, etc. This looks like the *configuration* of a card for an entity, not the *field values*.
    *   *Field Values*: Field values are stored in `entity_metadata` (Dexie) / `attributes` (Go Entity).
    *   *Refinement*: We might need to ensure `storeUpsertEntity` handles the attributes (metadata), or if there's a specific "Fact Sheet Data" table.
    *   *Action*: We will focus on `storeUpsertEntityCard` for the card layout configuration for now, as per the API exposed.

#### [MODIFY] [discoveryStore.ts](file:///c:/Users/shuga/1kittroot/1code/Angular-build/src/app/lib/store/discoveryStore.ts)
*   Inject `GoKittService` (convert from Class to Signal-Store or Service).
*   Add persistence:
    *   `loadCandidates()`: Fetch from `goKitt.storeListDiscoveryCandidates`.
    *   `saveCandidate()`: Call `goKitt.storeUpsertDiscoveryCandidate`.

## Verification Plan

### Automated Tests
*   Run the app and verify no errors in console.
*   Check `sqlite_store.go` logs (if visible) or generic "Success" responses from `GoKittService`.

### Manual Verification
1.  **Network View**: Create a new network, add entities, add relationships. Verify operations succeed without error.
2.  **Fact Sheets**: Modify a fact sheet card (collapse/expand, move). Verify persistence.
3.  **Discovery**: (If applicable) Verify candidates list loads (initially likely empty) and specific actions persist.
