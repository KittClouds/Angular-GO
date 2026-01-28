# Boot Orchestration System

## Overview

The application uses a phased boot sequence to ensure critical data is available before components render.

## Boot Phases

| Phase | Name | Description | Files |
|-------|------|-------------|-------|
| 0 | **Polyfills** | Global polyfills (fs, Go WASM) | `main.ts` |
| 1 | **Boot Cache** | Pre-load Dexie data BEFORE Angular | `boot-cache.ts`, `main.ts` |
| 2 | **Angular Bootstrap** | Start Angular framework | `main.ts` |
| 3 | **Data Layer** | Seed schemas | `app.component.ts` |
| 4 | **Registry** | Hydrate from boot cache (instant) | `registry.ts` |
| 5 | **WASM Load** | Load GoKitt.wasm module | `gokitt.service.ts` |
| 6 | **WASM Hydrate** | Pass entities to Aho-Corasick | `gokitt.service.ts` |
| 7 | **Ready** | App fully operational | `app-orchestrator.ts` |

## Key Files

### `src/main.ts`
Entry point. Loads boot cache BEFORE Angular:
```typescript
preloadBootCache()
  .then(() => bootstrapApplication(AppComponent, appConfig))
```

### `src/app/lib/core/boot-cache.ts`
Pre-loads Dexie data into memory:
- `preloadBootCache()` - Call in main.ts
- `getBootCache()` - Sync access to cached data
- `waitForBootCache()` - Async wait if needed

### `src/app/lib/core/app-orchestrator.ts`
Coordinates phase transitions:
- `completePhase(phase)` - Signal phase done
- `waitFor(phase)` - Block until phase complete
- `isReady` - Signal for template guards

### `src/app/lib/registry.ts`
Entity registry using boot cache:
- `init()` uses boot cache (instant)
- Falls back to Dexie if cache not ready

### `src/app/services/gokitt.service.ts`
WASM lifecycle:
- `loadWasm()` - Phase 5: Load module
- `hydrateWithEntities()` - Phase 6: Build Aho-Corasick
- `refreshDictionary()` - Update after entity changes

## Expected Console Output

```
[Main] Starting application boot...
[BootCache] Starting pre-Angular data load...
[BootCache] ✓ Loaded 7 entities, 4 edges in 45ms
[Main] Boot cache ready, starting Angular...
[Orchestrator] Boot sequence started
[AppComponent] Starting orchestrated boot...
[AppComponent] ✓ Seed complete
[Orchestrator] ✓ Phase 'data_layer' complete (23ms)
[CentralRegistry] ✓ Initialized: 7 entities, 4 edges (2ms, from cache)
[AppComponent] ✓ SmartGraphRegistry hydrated
[Orchestrator] ✓ Phase 'registry' complete (5ms)
[GoKittService] WASM module loaded
[Orchestrator] ✓ Phase 'wasm_load' complete (80ms)
[GoKittService] Hydrated with 7 entities: {"success":"initialized"}
[AppComponent] ✓ WASM hydrated with entities
[Orchestrator] ✓ Phase 'wasm_hydrate' complete (3ms)
[Orchestrator] ✓ Phase 'ready' complete (0ms)
[Orchestrator] 🚀 App ready in 115ms
```

## Waiting for Phases

Components can wait for specific phases:

```typescript
import { AppOrchestrator } from './lib/core/app-orchestrator';

// In component
private orchestrator = inject(AppOrchestrator);

async ngOnInit() {
  await this.orchestrator.waitFor('wasm_hydrate');
  // Now safe to use GoKitt
}

// In template (with signal)
@if (orchestrator.isReady()) {
  <my-component />
}
```

## Troubleshooting

### Registry data appears last
**Problem**: `[CentralRegistry] Initialized` appears after editor loads
**Solution**: Check that `main.ts` calls `preloadBootCache()` before `bootstrapApplication()`

### WASM loads twice
**Problem**: `[GoKitt] WASM Ready` appears twice in console
**Solution**: GoKittService should NOT call `initWasm()` in constructor. It's called by AppComponent.

### Empty Aho-Corasick dictionary
**Problem**: Implicit entities not highlighted
**Solution**: Ensure `hydrateWithEntities()` is called AFTER registry.init() completes.
