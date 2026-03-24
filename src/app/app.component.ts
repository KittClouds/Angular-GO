import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainLayoutComponent } from './components/layout/main-layout/main-layout.component';
import { NgxSpinnerModule, NgxSpinnerService } from 'ngx-spinner';
import { Subscription } from 'rxjs';

import { smartGraphRegistry } from './lib/registry';
import { entityColorStore } from './lib/store/entityColorStore';
import { seedDefaultSchemas } from './lib/folders/seed';
import { setDiscoveryStore, setPhoenixUiApi } from './api/pretty-text-api';
import { AppOrchestrator, setAppOrchestrator } from './lib/core/app-orchestrator';
import { ProjectionCacheService } from './lib/services/projection-cache.service';
import { KnowledgeService } from './services/knowledge.service';
import { getNavigationApi } from './api/navigation-api';
import { NotesService } from './lib/dexie/notes.service';
import { NoteEditorStore } from './lib/store/note-editor.store';
import { DiscoveryStore } from './lib/store/discoveryStore';
import { setPhoenixStoreBridge } from './lib/operations';
import * as ops from './lib/operations';
import { FactSheetService } from './components/fact-sheets/fact-sheet.service';
import { db } from './lib/dexie/db';
import { PhoenixUiApiService } from './services/phoenix-ui-api.service';
import { PhoenixStoreService } from './services/phoenix-store.service';

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
  private phoenixUiApi = inject(PhoenixUiApiService);
  private phoenixStore = inject(PhoenixStoreService);
  private orchestrator = inject(AppOrchestrator);
  private projectionCache = inject(ProjectionCacheService);
  private notesService = inject(NotesService);
  private noteEditorStore = inject(NoteEditorStore);
  private knowledgeService = inject(KnowledgeService);
  private discoveryStore = inject(DiscoveryStore);
  private factSheetService = inject(FactSheetService);

  // Navigation API subscriptions
  private notesSub: Subscription | null = null;
  private navUnsubscribe: (() => void) | null = null;
  private bootStep = 'boot:start';
  private bootWatchdog: ReturnType<typeof setInterval> | null = null;

  async ngOnInit() {
    // Phase 0: Shell - spinner visible
    this.spinner.show();
    this.startBootWatchdog();

    // Export orchestrator for non-DI contexts
    setAppOrchestrator(this.orchestrator);

    // Wire up Phoenix to PrettyText API
    setPhoenixUiApi(this.phoenixUiApi);
    setDiscoveryStore(this.discoveryStore);

    // Initialize entity color CSS variables (sync, no deps)
    entityColorStore.initialize();

    // Wire up Navigation API
    this.wireUpNavigationApi();

    console.log('[AppComponent] Starting orchestrated boot...');

    try {
      this.setBootStep('seed:start');
      const seedPromise = seedDefaultSchemas();
      this.setBootStep('phoenix:loadWasm:start');
      const wasmLoadPromise = this.phoenixUiApi.loadWasm();

      await seedPromise;
      console.log('[AppComponent] Seed complete');
      this.setBootStep('seed:complete');

      this.setBootStep('phoenix:loadWasm:await');
      await wasmLoadPromise;
      console.log('[AppComponent] Phoenix WASM module loaded');
      this.orchestrator.completePhase('wasm_load');
      this.setBootStep('phoenix:loadWasm:complete');

      this.setBootStep('phoenixStore:initialize:start');
      await this.phoenixStore.initialize();
      console.log('[AppComponent] Phoenix Store initialized');
      this.setBootStep('phoenixStore:initialize:complete');

      // Phoenix is the backend source of truth. Dexie gets wiped and rebuilt.
      this.setBootStep('dexie:hydrate:start');
      await this.hydrateDexieFromPhoenix();
      this.setBootStep('dexie:hydrate:complete');

      // Connect operations after Dexie mirrors Phoenix.
      setPhoenixStoreBridge(this.phoenixStore);
      console.log('[AppComponent] Dexie hydrated from Phoenix backend');

      this.setBootStep('registry+editor:start');
      await Promise.all([
        this.noteEditorStore.restoreActiveNote().then(() => {
          console.log('[AppComponent] Active note restored');
        }),
        smartGraphRegistry.init().then(() => {
          console.log('[AppComponent] SmartGraphRegistry hydrated');
        })
      ]);
      this.orchestrator.completePhase('registry');
      this.setBootStep('registry+editor:complete');

      this.setBootStep('phoenix:hydrateWithEntities:start');
      await this.phoenixUiApi.hydrateWithEntities();
      console.log('[AppComponent] Phoenix hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');
      this.setBootStep('phoenix:hydrateWithEntities:complete');

      this.orchestrator.completePhase('ready');
      this.setBootStep('boot:ready');

      this.setBootStep('background:start');
      const knowledgePromise = (async () => {
        try {
          await this.knowledgeService.init();
          console.log('[AppComponent] Knowledge Graph hydrated (background)');
        } catch (err) {
          console.error('[AppComponent] Knowledge Graph hydration failed:', err);
        }
      })();

      const docStorePromise = (async () => {
        try {
          const allNotes = await this.phoenixStore.listNotes();

          const noteData = allNotes.map((n) => {
            let text = '';
            if (typeof n.content === 'string') {
              if (n.content.trim().startsWith('{')) {
                try {
                  const json = JSON.parse(n.content);
                  text = extractTextFromContent(json);
                } catch {
                  text = n.content;
                }
              } else {
                text = n.content;
              }
            } else {
              text = extractTextFromContent(n.content);
            }

            return {
              id: n.id,
              title: n.title || n.id,
              text,
              version: n.updatedAt ?? 0,
              narrativeId: n.narrativeId || '',
              folderPath: n.folderId || ''
            };
          });

          await this.phoenixUiApi.hydrateNotes(noteData);
          console.log(`[AppComponent] DocStore hydrated with ${noteData.length} notes (from Phoenix store)`);
        } catch (err) {
          console.error('[AppComponent] DocStore hydration failed:', err);
        }
      })();

      const factSheetPromise = (async () => {
        try {
          await this.factSheetService.syncToBackend();
          console.log('[AppComponent] FactSheet schemas synced (background)');
        } catch (err) {
          console.error('[AppComponent] FactSheet sync failed:', err);
        }
      })();

      void Promise.all([knowledgePromise, docStorePromise, factSheetPromise]).then(() => {
        this.orchestrator.completePhase('background');
        this.setBootStep('background:complete');
      });
    } catch (err) {
      console.error('[AppComponent] Boot failed:', err);
      this.setBootStep('boot:failed');
    } finally {
      this.stopBootWatchdog();
      // Minimum display time for spinner
      await new Promise(resolve => setTimeout(resolve, 300));
      this.spinner.hide();
    }
  }

  /**
   * One-way hydration: SQLite -> Dexie.
   * Dexie is wiped clean and rebuilt from SQLite's data.
   * This replaces what DataSyncService.init() used to do.
   */
  private async hydrateDexieFromPhoenix(): Promise<void> {
    console.log('[AppComponent] Hydrating Dexie from Phoenix backend...');
    const start = Date.now();

    // Pause snapshots during hydration to prevent pointless OPFS writes
    this.phoenixStore.pauseSnapshots();

    try {
      const [notes, entities, edges, folders] = await Promise.all([
        this.phoenixStore.listNotes(),
        this.phoenixStore.listEntities(),
        this.phoenixStore.listAllEdges(),
        this.phoenixStore.listFolders()
      ]);

      await db.transaction('rw', db.notes, db.entities, db.edges, db.folders, async () => {
        await Promise.all([
          db.notes.clear(),
          db.entities.clear(),
          db.edges.clear(),
          db.folders.clear()
        ]);

        if (notes.length > 0) await db.notes.bulkPut(notes.map(n => this.toNote(n)));
        if (entities.length > 0) await db.entities.bulkPut(entities.map(e => this.toEntity(e)));
        if (edges.length > 0) await db.edges.bulkPut(edges.map(e => this.toEdge(e)));
        if (folders.length > 0) await db.folders.bulkPut(folders.map(f => this.toFolder(f)));
      });

      console.log(`[AppComponent] Dexie hydrated in ${Date.now() - start}ms: ${notes.length} notes, ${folders.length} folders, ${entities.length} entities, ${edges.length} edges`);
    } finally {
      this.phoenixStore.resumeSnapshots();
    }
  }

  // =========================================================================
  // Mappers (Store -> Dexie)
  // =========================================================================

  private toNote(n: any): any {
    return {
      id: n.id, worldId: n.worldId, title: n.title, content: n.content,
      markdownContent: n.markdownContent, folderId: n.folderId,
      entityKind: n.entityKind, entitySubtype: n.entitySubtype,
      isEntity: n.isEntity, isPinned: n.isPinned, favorite: n.favorite,
      ownerId: n.ownerId, narrativeId: n.narrativeId, order: n.order,
      createdAt: n.createdAt, updatedAt: n.updatedAt
    };
  }

  private toEntity(e: any): any {
    return {
      id: e.id, label: e.label, kind: e.kind, subtype: e.subtype,
      aliases: e.aliases, firstNote: e.firstNote, totalMentions: e.totalMentions,
      narrativeId: e.narrativeId, createdBy: e.createdBy,
      createdAt: e.createdAt, updatedAt: e.updatedAt
    };
  }

  private toFolder(f: any): any {
    let attributes: Record<string, any> | undefined;
    if (f.attributes) {
      try { attributes = typeof f.attributes === 'string' ? JSON.parse(f.attributes) : f.attributes; } catch { attributes = undefined; }
    }
    return {
      id: f.id, name: f.name, parentId: f.parentId || '', worldId: f.worldId,
      narrativeId: f.narrativeId || '', order: f.folderOrder,
      createdAt: f.createdAt, updatedAt: f.updatedAt,
      entityKind: f.entityKind || '', entitySubtype: f.entitySubtype || '',
      entityLabel: f.entityLabel || '', color: f.color || '',
      isTypedRoot: f.isTypedRoot || false, isSubtypeRoot: f.isSubtypeRoot || false,
      collapsed: f.collapsed || false, ownerId: f.ownerId || '',
      isNarrativeRoot: f.isNarrativeRoot || false, attributes
    };
  }

  private toEdge(e: any): any {
    return {
      id: e.id, sourceId: e.sourceId, targetId: e.targetId,
      relType: e.relType, confidence: e.confidence,
      bidirectional: e.bidirectional,
    };
  }

  ngOnDestroy(): void {
    if (this.notesSub) this.notesSub.unsubscribe();
    if (this.navUnsubscribe) this.navUnsubscribe();
    this.stopBootWatchdog();
  }

  private setBootStep(step: string): void {
    this.bootStep = step;
    console.log(`[AppComponent] Boot step -> ${step}`);
  }

  private startBootWatchdog(): void {
    this.stopBootWatchdog();
    const startedAt = Date.now();
    this.bootWatchdog = setInterval(() => {
      console.warn(
        `[AppComponent] Boot watchdog: still waiting at '${this.bootStep}' after ${Date.now() - startedAt}ms`,
      );
    }, 5000);
  }

  private stopBootWatchdog(): void {
    if (this.bootWatchdog) {
      clearInterval(this.bootWatchdog);
      this.bootWatchdog = null;
    }
  }

  /**
   * Wire up Navigation API for cross-note navigation from entity clicks.
   */
  private wireUpNavigationApi(): void {
    const navigationApi = getNavigationApi();
    this.notesSub = this.notesService.getAllNotes$().subscribe(notes => {
      navigationApi.setNotes(notes as any);
      console.log(`[AppComponent] NavigationApi synced with ${notes.length} notes`);
    });
    this.navUnsubscribe = navigationApi.onNavigate((noteId) => {
      console.log('[AppComponent] Navigation handler triggered:', noteId);
      this.noteEditorStore.openNote(noteId);
    });
    console.log('[AppComponent] Navigation API wired up');
  }
}

/**
 * Helper to recursively extract plain text from Prosemirror JSON.
 */
function extractTextFromContent(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  let text = '';
  if (content.type === 'text' && content.text) return content.text;

  if (content.content && Array.isArray(content.content)) {
    for (const child of content.content) {
      text += extractTextFromContent(child);
      if (child.type === 'paragraph' || child.type === 'heading' || child.type === 'listItem') {
        text += '\n';
      }
    }
  }
  return text;
}
