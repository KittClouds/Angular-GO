import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainLayoutComponent } from './components/layout/main-layout/main-layout.component';
import { NgxSpinnerModule, NgxSpinnerService } from 'ngx-spinner';
import { Subscription, firstValueFrom } from 'rxjs';

import { smartGraphRegistry } from './lib/registry';
import { entityColorStore } from './lib/store/entityColorStore';
import { seedDefaultSchemas } from './lib/folders/seed';
import { GoKittService } from './services/gokitt.service';
import { GoKittStoreService } from './services/gokitt-store.service';
import { setGoKittService } from './api/pretty-text-api';
import { AppOrchestrator, setAppOrchestrator } from './lib/core/app-orchestrator';
import { GoSqliteCozoBridge } from './lib/bridge/GoSqliteCozoBridge';
import { cozoDb } from './lib/cozo/db';
import { ProjectionCacheService } from './lib/services/projection-cache.service';
import { getNavigationApi } from './api/navigation-api';
import { NotesService } from './lib/dexie/notes.service';
import { NoteEditorStore } from './lib/store/note-editor.store';
import { setGoSqliteBridge } from './lib/operations';
import * as ops from './lib/operations';

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
  private goKittStore = inject(GoKittStoreService);
  private orchestrator = inject(AppOrchestrator);
  private goSqliteBridge = inject(GoSqliteCozoBridge);
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
      // Phase 1: Seed (fast, sync schemas)
      await seedDefaultSchemas();
      console.log('[AppComponent] ✓ Seed complete');

      // Phase 2: Registry (from Dexie cache — ~1ms)
      await smartGraphRegistry.init();
      console.log('[AppComponent] ✓ SmartGraphRegistry hydrated');
      this.orchestrator.completePhase('registry');

      // Phase 3: WASM Load (parallel with CozoDB background init)
      // Start CozoDB in background — NOT on critical path
      const cozoPromise = cozoDb.init().then(() => {
        console.log('[AppComponent] ✓ CozoDB initialized (background)');
      }).catch(err => {
        console.error('[AppComponent] CozoDB background init failed:', err);
      });

      // WASM load is the critical gate
      await this.goKitt.loadWasm();
      console.log('[AppComponent] ✓ WASM module loaded');
      this.orchestrator.completePhase('wasm_load');

      // Phase 4: WASM Hydrate entities (fast — just entity names for Aho-Corasick)
      await this.goKitt.hydrateWithEntities();
      console.log('[AppComponent] ✓ WASM hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');

      // Phase 5: GoSQLite Bridge (OPFS restore — needed for note reads)
      await this.goSqliteBridge.init();
      setGoSqliteBridge(this.goSqliteBridge);
      console.log('[AppComponent] ✓ GoSQLite-Cozo Bridge initialized');

      // 🚀 APP IS INTERACTIVE — user can see + edit notes
      this.orchestrator.completePhase('ready');

      // Note restoration is handled by NoteEditorStore.restoreActiveNote() in constructor
      // No need to duplicate here - the store already loads from 'kittclouds-active-note'

      // ======================================================================
      // Background tasks (non-blocking, after first paint)
      // ======================================================================

      // DocStore hydrate (search index) — doesn't block editing
      const docStorePromise = (async () => {
        try {
          const allNotes = await firstValueFrom(this.notesService.getAllNotes$()) || [];
          const noteData = allNotes.map((n: any) => ({
            id: n.id,
            text: typeof n.content === 'string' ? n.content : JSON.stringify(n.content),
            version: n.updatedAt ?? 0
          }));
          await this.goKitt.hydrateNotes(noteData);
          console.log(`[AppComponent] ✓ DocStore hydrated with ${noteData.length} notes (background)`);
        } catch (err) {
          console.error('[AppComponent] DocStore hydration failed:', err);
        }
      })();

      // Wait for all background tasks
      await Promise.all([cozoPromise, docStorePromise]);
      this.orchestrator.completePhase('background');

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
