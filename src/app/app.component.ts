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
import { ProjectionCacheService } from './lib/services/projection-cache.service';
import { KnowledgeService } from './services/knowledge.service';
import { getNavigationApi } from './api/navigation-api';
import { NotesService } from './lib/dexie/notes.service';
import { NoteEditorStore } from './lib/store/note-editor.store';
import { DiscoveryStore } from './lib/store/discoveryStore';
import { setGoSqliteBridge } from './lib/operations';
import * as ops from './lib/operations';
import { FactSheetService } from './components/fact-sheets/fact-sheet.service';
import { db } from './lib/dexie/db';

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

      // Phase 3: Hydrate Dexie from SQLite (One-Way Push)
      // SQLite is the SOLE source of truth. Dexie gets wiped and rebuilt.
      await this.hydrateDexieFromSqlite();

      // Connect operations module to GoKittStoreService directly
      setGoSqliteBridge(this.goKittStore);
      console.log('[AppComponent] ✓ Dexie hydrated from SQLite (Pure OPFS Mode)');

      // Phase 3.5: Restore active note AFTER Dexie is populated and bridge is wired.
      // Previously this ran in NoteEditorStore's constructor (too early — Dexie was empty).
      await this.noteEditorStore.restoreActiveNote();
      console.log('[AppComponent] ✓ Active note restored');

      // Phase 4: Registry Hydration
      // Dexie is now guaranteed to mirror SQLite exactly
      await smartGraphRegistry.init();
      console.log('[AppComponent] ✓ SmartGraphRegistry hydrated');
      this.orchestrator.completePhase('registry');

      // Phase 5: WASM Entity Hydration (Aho-Corasick)
      await this.goKitt.hydrateWithEntities();
      console.log('[AppComponent] ✓ WASM hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');

      // 🚀 APP IS INTERACTIVE
      this.orchestrator.completePhase('ready');

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
          const allNotes = await this.goKittStore.listNotes();

          const noteData = allNotes.map((n) => {
            let text = '';
            if (typeof n.content === 'string') {
              if (n.content.trim().startsWith('{')) {
                try {
                  const json = JSON.parse(n.content);
                  text = extractTextFromContent(json);
                } catch (e) {
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

  /**
   * One-way hydration: SQLite → Dexie.
   * Dexie is wiped clean and rebuilt from SQLite's data.
   * This replaces what DataSyncService.init() used to do.
   */
  private async hydrateDexieFromSqlite(): Promise<void> {
    console.log('[AppComponent] 🔄 Hydrating Dexie from SQLite...');
    const start = Date.now();

    // Pause snapshots during hydration to prevent pointless OPFS writes
    this.goKittStore.pauseSnapshots();

    try {
      // Fetch all data from SQLite (The Truth)
      const [notes, entities, edges, folders] = await Promise.all([
        this.goKittStore.listNotes(),
        this.goKittStore.listEntities(),
        this.goKittStore.listAllEdges(),
        this.goKittStore.listFolders()
      ]);

      // Wipe Dexie clean and repopulate
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

      console.log(`[AppComponent] ✅ Dexie hydrated in ${Date.now() - start}ms: ${notes.length} notes, ${folders.length} folders, ${entities.length} entities, ${edges.length} edges`);
    } finally {
      this.goKittStore.resumeSnapshots();
    }
  }

  // =========================================================================
  // Mappers (Store → Dexie)
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
