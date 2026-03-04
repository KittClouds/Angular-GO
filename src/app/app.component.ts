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
import { setGoKittService, setDiscoveryStore } from './api/pretty-text-api';
import { AppOrchestrator, setAppOrchestrator } from './lib/core/app-orchestrator';
import { DataSyncService } from './lib/bridge/DataSyncService';
import { ProjectionCacheService } from './lib/services/projection-cache.service';
import { KnowledgeService } from './services/knowledge.service';
import { getNavigationApi } from './api/navigation-api';
import { NotesService } from './lib/dexie/notes.service';
import { NoteEditorStore } from './lib/store/note-editor.store';
import { DiscoveryStore } from './lib/store/discoveryStore';
import { setGoSqliteBridge } from './lib/operations';
import * as ops from './lib/operations';
import { FactSheetService } from './components/fact-sheets/fact-sheet.service';

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
  private dataSync = inject(DataSyncService);
  private projectionCache = inject(ProjectionCacheService);
  private notesService = inject(NotesService);
  private noteEditorStore = inject(NoteEditorStore);
  private knowledgeService = inject(KnowledgeService);
  private discoveryStore = inject(DiscoveryStore);
  private factSheetService = inject(FactSheetService);


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
    setDiscoveryStore(this.discoveryStore);

    // Initialize entity color CSS variables (sync, no deps)
    entityColorStore.initialize();

    // Wire up Navigation API
    this.wireUpNavigationApi();

    console.log('[AppComponent] Starting orchestrated boot...');

    try {
      // Phase 1: Seed schemas (fast, sync)
      await seedDefaultSchemas();
      console.log('[AppComponent] ✓ Seed complete');

      // Phase 2: WASM Load & SQLite Init
      await this.goKitt.loadWasm();
      console.log('[AppComponent] ✓ WASM module loaded');
      this.orchestrator.completePhase('wasm_load');

      await this.goKittStore.initialize();
      console.log('[AppComponent] ✓ GoKitt Store (SQLite) initialized');

      // Phase 3: Data Sync (SQLite → Dexie populate)
      // This populates Dexie synchronously from SQLite so the registry can hydrate
      await this.dataSync.init();
      setGoSqliteBridge(this.dataSync);
      console.log('[AppComponent] ✓ Data Sync (SQLite → Dexie) initialized');

      // Phase 4: Registry Hydration
      // Now Dexie is guaranteed to be fresh and matching SQLite
      await smartGraphRegistry.init();
      console.log('[AppComponent] ✓ SmartGraphRegistry hydrated');
      this.orchestrator.completePhase('registry');

      // Phase 5: WASM Entity Hydration (Aho-Corasick)
      await this.goKitt.hydrateWithEntities();
      console.log('[AppComponent] ✓ WASM hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');

      // 🚀 APP IS INTERACTIVE
      this.orchestrator.completePhase('ready');


      // Note restoration is handled by NoteEditorStore.restoreActiveNote() in constructor
      // No need to duplicate here - the store already loads from 'kittclouds-active-note'

      // ======================================================================
      // Background tasks (non-blocking, after first paint)
      // ======================================================================

      // Knowledge Graph (SQLite restore) — doesn't block editing
      const knowledgePromise = (async () => {
        try {
          await this.knowledgeService.init();
          console.log('[AppComponent] ✓ Knowledge Graph hydrated (background)');
        } catch (err) {
          console.error('[AppComponent] Knowledge Graph hydration failed:', err);
        }
      })();

      // DocStore hydrate (search index) — doesn't block editing
      const docStorePromise = (async () => {
        try {
          // [CHANGE] Hydraote Search from SQLite (Truth) not Dexie (Shadow)
          const allNotes = await this.goKittStore.listNotes();

          const noteData = allNotes.map((n) => {
            // Extract plain text from Prosemirror JSON for search indexing
            let text = '';
            if (typeof n.content === 'string') {
              // If it's already a string, check if it's JSON stringified
              if (n.content.trim().startsWith('{')) {
                try {
                  const json = JSON.parse(n.content);
                  text = extractTextFromContent(json);
                } catch (e) {
                  text = n.content; // Fallback to raw string
                }
              } else {
                text = n.content;
              }
            } else {
              // It's an object (Prosemirror JSON)
              text = extractTextFromContent(n.content);
            }

            return {
              id: n.id,
              text: text,
              version: n.updatedAt ?? 0,
              narrativeId: n.narrativeId || '',
              folderPath: n.folderId || ''
            };
          });

          await this.goKitt.hydrateNotes(noteData);
          console.log(`[AppComponent] ✓ DocStore hydrated with ${noteData.length} notes (from SQLite)`);
        } catch (err) {
          console.error('[AppComponent] DocStore hydration failed:', err);
        }
      })();

      // FactSheet schema sync (batched TX to GoKitt) — doesn't block editing
      const factSheetPromise = (async () => {
        try {
          await this.factSheetService.syncToBackend();
          console.log('[AppComponent] ✓ FactSheet schemas synced (background)');
        } catch (err) {
          console.error('[AppComponent] FactSheet sync failed:', err);
        }
      })();

      // Wait for all background tasks
      await Promise.all([knowledgePromise, docStorePromise, factSheetPromise]);
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

/**
 * Helper to recursively extract plain text from Prosemirror JSON
 */
function extractTextFromContent(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  let text = '';

  // If it's a text node, return its text
  if (content.type === 'text' && content.text) {
    return content.text;
  }

  // If it has content (array), recurse
  if (content.content && Array.isArray(content.content)) {
    for (const child of content.content) {
      text += extractTextFromContent(child);
      // Add newline for block nodes to avoid smashing text together
      if (child.type === 'paragraph' || child.type === 'heading' || child.type === 'listItem') {
        text += '\n';
      }
    }
  }

  return text;
}
