import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainLayoutComponent } from './components/layout/main-layout/main-layout.component';
import { NgxSpinnerModule, NgxSpinnerService } from 'ngx-spinner';
import { Subscription } from 'rxjs';

import { smartGraphRegistry } from './lib/registry';
import { entityColorStore } from './lib/store/entityColorStore';
import { seedDefaultSchemas } from './lib/folders/seed';
import { GoKittService } from './services/gokitt.service';
import { setGoKittService } from './api/highlighter-api';
import { AppOrchestrator, setAppOrchestrator } from './lib/core/app-orchestrator';
import { NebulaCozoBridge } from './lib/bridge';
import { cozoDb } from './lib/cozo/db';
import { ProjectionCacheService } from './lib/services/projection-cache.service';
import { getNavigationApi } from './api/navigation-api';
import { NotesService } from './lib/dexie/notes.service';
import { NoteEditorStore } from './lib/store/note-editor.store';
import { setNebulaBridge } from './lib/nebula/operations';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MainLayoutComponent, NgxSpinnerModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'angular-notes';
  private spinner = inject(NgxSpinnerService);
  private goKitt = inject(GoKittService);
  private orchestrator = inject(AppOrchestrator);
  private nebulaBridge = inject(NebulaCozoBridge);
  private projectionCache = inject(ProjectionCacheService);
  private notesService = inject(NotesService);
  private noteEditorStore = inject(NoteEditorStore);


  // Navigation API subscriptions
  private notesSub: Subscription | null = null;
  private navUnsubscribe: (() => void) | null = null;

  async ngOnInit() {
    // Phase 0: Shell - spinner visible
    this.spinner.show();

    // Export orchestrator for non-DI contexts
    setAppOrchestrator(this.orchestrator);

    // Wire up GoKitt to Highlighter API (doesn't start WASM yet)
    setGoKittService(this.goKitt);

    // Initialize entity color CSS variables (sync, no deps)
    entityColorStore.initialize();

    // Wire up Navigation API
    this.wireUpNavigationApi();

    console.log('[AppComponent] Starting orchestrated boot...');

    try {
      // Phase 1: Data Layer - Dexie + Seed
      await seedDefaultSchemas();
      console.log('[AppComponent] ✓ Seed complete');
      this.orchestrator.completePhase('data_layer');

      // Phase 2: Registry + CozoDB - hydrate from Dexie (parallel with WASM load)
      const registryPromise = smartGraphRegistry.init().then(async () => {
        console.log('[AppComponent] ✓ SmartGraphRegistry hydrated');
        this.orchestrator.completePhase('registry');

        // Initialize CozoDB (WASM + persistence)
        await cozoDb.init();

        // Initialize NebulaDB-CozoDB bridge (hydrates from Cozo, primary data layer)
        await this.nebulaBridge.init();

        // Wire up bridge for non-DI contexts (operations.ts)
        setNebulaBridge(this.nebulaBridge);
        console.log('[AppComponent] ✓ NebulaDB bridge initialized and wired');
      });

      // Phase 3: WASM Load - load module (parallel with registry)
      const wasmLoadPromise = this.goKitt.loadWasm().then(() => {
        console.log('[AppComponent] ✓ WASM module loaded');
        this.orchestrator.completePhase('wasm_load');
      });

      // Wait for both registry AND wasm to be ready
      await Promise.all([registryPromise, wasmLoadPromise]);

      // Phase 4: WASM Hydrate - pass entities to GoKitt
      await this.goKitt.hydrateWithEntities();
      console.log('[AppComponent] ✓ WASM hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');

      // Phase 5: Ready
      this.orchestrator.completePhase('ready');

    } catch (err) {
      console.error('[AppComponent] Boot failed:', err);
    } finally {
      // Minimum display time for spinner
      await new Promise(resolve => setTimeout(resolve, 300));
      this.spinner.hide();
    }
  }

  ngOnDestroy(): void {
    // Clean up Navigation API subscriptions
    if (this.notesSub) {
      this.notesSub.unsubscribe();
    }
    if (this.navUnsubscribe) {
      this.navUnsubscribe();
    }
  }

  /**
   * Wire up Navigation API for cross-note navigation from entity clicks.
   * - Syncs notes list to NavigationApi.setNotes()
   * - Registers handler to open notes via NoteEditorStore
   */
  private wireUpNavigationApi(): void {
    const navigationApi = getNavigationApi();

    // Sync notes to Navigation API whenever they change
    this.notesSub = this.notesService.getAllNotes$().subscribe(notes => {
      // Map Dexie Note to API Note type (they're compatible)
      navigationApi.setNotes(notes as any);
      console.log(`[AppComponent] NavigationApi synced with ${notes.length} notes`);
    });

    // Register navigation handler
    this.navUnsubscribe = navigationApi.onNavigate((noteId) => {
      console.log('[AppComponent] Navigation handler triggered:', noteId);
      this.noteEditorStore.openNote(noteId);
    });

    console.log('[AppComponent] ✓ Navigation API wired up');
  }
}
