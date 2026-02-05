import { Component, signal, computed, effect, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideSearch, lucideCpu, lucideZap, lucideLayers, lucideLoader2,
  lucideCheckCircle2, lucideAlertCircle, lucideChevronDown, lucideFileText,
  lucideSparkles, lucideMicrochip, lucideFolder, lucideGlobe
} from '@ng-icons/lucide';
import { SemanticSearchService } from '../../lib/services/semantic-search.service';

type RagStatus = 'idle' | 'initializing' | 'loading-model' | 'setting-dims' | 'ready' | 'indexing' | 'searching' | 'error';
type SearchMode = 'vector' | 'hybrid' | 'raptor';
type TruncateDim = 'full' | '256' | '128' | '64';
type EmbedMode = 'rust' | 'typescript';
type ModelId = 'mdbr-leaf' | 'bge-small' | 'modernbert-base';

interface SearchResult {
  note_id: string;
  note_title: string;
  chunk_text: string;
  score: number;
  chunk_index: number;
}

interface RagStats {
  notes: number;
  chunks: number;
}

@Component({
  selector: 'app-search-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [provideIcons({
    lucideSearch, lucideCpu, lucideZap, lucideLayers, lucideLoader2,
    lucideCheckCircle2, lucideAlertCircle, lucideChevronDown, lucideFileText,
    lucideSparkles, lucideMicrochip, lucideFolder, lucideGlobe
  })],
  template: `
    <div class="flex flex-col h-full text-foreground bg-sidebar">
      <!-- Header -->
      <div class="relative overflow-hidden rounded-lg bg-gradient-to-br from-zinc-900 via-zinc-900 to-teal-950/40 border border-teal-500/20 p-4 mb-4 shrink-0 shadow-lg">
        <!-- Subtle glow effect -->
        <div class="absolute inset-0 bg-gradient-to-r from-teal-500/5 via-transparent to-cyan-500/5 pointer-events-none"></div>

        <div class="relative">
          <!-- Title row -->
          <div class="flex items-center gap-3 mb-3">
            <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500/20 to-cyan-500/10 border border-teal-500/30 shadow-inner shadow-teal-500/10">
              <ng-icon name="lucideSparkles" class="w-5 h-5 text-teal-400"></ng-icon>
            </div>
            <div>
              <h2 class="text-base font-semibold text-zinc-100 tracking-tight">Semantic Search</h2>
              <div class="flex items-center gap-2 text-xs">
                <span class="text-zinc-500 font-medium">{{ embedMode() === 'typescript' ? 'TypeScript' : 'Rust/WASM' }}</span>
                <span class="text-zinc-600">•</span>
                <span class="text-teal-400 font-medium tracking-wide">
                  {{ getModelLabel(selectedModel()) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Status badge -->
          <div class="flex items-center gap-2">
            <div 
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800/80 border border-zinc-700/50 backdrop-blur-sm transition-colors duration-300"
              [class.border-red-500_20]="status() === 'error'"
              [class.bg-red-500_10]="status() === 'error'"
            >
              <ng-icon 
                [name]="statusDisplay().icon" 
                class="w-3 h-3 transition-colors duration-300"
                [class.animate-spin]="statusDisplay().spin"
                [ngClass]="statusDisplay().color"
              ></ng-icon>
              <span [ngClass]="statusDisplay().color" class="transition-colors duration-300">{{ statusDisplay().text }}</span>
            </div>

            <div *ngIf="stats().chunks > 0" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/10 border border-teal-500/20 text-teal-300">
              <ng-icon name="lucideFileText" class="w-3 h-3"></ng-icon>
              {{ stats().chunks }} chunks
            </div>
          </div>
        </div>
      </div>

      <!-- Search Input -->
      <div class="relative mb-3 shrink-0 group">
        <ng-icon name="lucideSearch" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-teal-400 transition-colors duration-200"></ng-icon>
        <input
          type="text"
          placeholder="Search your notes..."
          class="w-full pl-9 pr-3 h-10 rounded-md bg-zinc-900/60 border border-zinc-700/50 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all duration-200"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          (keydown.enter)="handleSearch()"
          [disabled]="status() !== 'ready'"
        />
      </div>

      <!-- Search Mode Toggles -->
      <div class="flex items-center gap-1 p-1 rounded-lg bg-zinc-950/40 border border-zinc-800/60 mb-3 shrink-0 shadow-sm">
        <button
          *ngFor="let mode of modes"
          (click)="searchMode.set(mode.id)"
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all duration-300 relative overflow-hidden group"
          [class.bg-gradient-to-b]="searchMode() === mode.id"
          [class.from-teal-500_10]="searchMode() === mode.id"
          [class.to-teal-500_5]="searchMode() === mode.id"
          [class.text-teal-300]="searchMode() === mode.id"
          [class.border]="true"
          [class.border-teal-500_30]="searchMode() === mode.id"
          [class.shadow-sm]="searchMode() === mode.id"
          [class.shadow-teal-500_5]="searchMode() === mode.id"
          [class.text-zinc-500]="searchMode() !== mode.id"
          [class.border-transparent]="searchMode() !== mode.id"
          [class.hover:text-zinc-300]="searchMode() !== mode.id"
          [class.hover:bg-zinc-800_40]="searchMode() !== mode.id"
        >
          <!-- Active Glow -->
          <div *ngIf="searchMode() === mode.id" class="absolute inset-0 bg-teal-400/5 mix-blend-overlay"></div>
          
          <ng-icon [name]="mode.icon" class="w-3.5 h-3.5 relative z-10 transition-transform group-hover:scale-110 duration-200"></ng-icon>
          <span class="relative z-10">{{ mode.label }}</span>
        </button>
      </div>

      <!-- Advanced Settings Toggle -->
      <div class="mb-3 shrink-0">
        <button 
          (click)="toggleAdvanced()"
          class="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/50 hover:border-zinc-700/50 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80 transition-all duration-200 group"
        >
          <span class="flex items-center gap-2">
            <div class="p-1 rounded bg-zinc-800/50 group-hover:bg-zinc-700/50 transition-colors">
                 <ng-icon name="lucideCpu" class="w-3.5 h-3.5"></ng-icon>
            </div>
            Model Settings
          </span>
          <ng-icon 
            name="lucideChevronDown" 
            class="w-4 h-4 transition-transform duration-200 text-zinc-600 group-hover:text-zinc-400"
            [class.rotate-180]="showAdvanced()"
          ></ng-icon>
        </button>

        <!-- Collapsible Content -->
        <div 
          class="overflow-hidden transition-all duration-300 ease-in-out"
          [style.max-height]="showAdvanced() ? '400px' : '0'"
          [style.opacity]="showAdvanced() ? '1' : '0'"
          [style.margin-top]="showAdvanced() ? '0.75rem' : '0'"
        >
          <div class="p-3 rounded-lg bg-zinc-950/30 border border-zinc-800/50 space-y-3 shadow-inner">
             <!-- Model Selection -->
             <div>
                <div class="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2 px-1">Embedding Model</div>
                <div class="grid grid-cols-1 gap-2">
                  <button
                    *ngFor="let model of models"
                    (click)="selectedModel.set(model.id)"
                    class="p-2.5 rounded-md text-xs text-left transition-all relative overflow-hidden group border"
                    [class.bg-teal-950_30]="selectedModel() === model.id"
                    [class.border-teal-500_30]="selectedModel() === model.id"
                    [class.text-teal-200]="selectedModel() === model.id"
                    [class.bg-zinc-900_40]="selectedModel() !== model.id"
                    [class.border-zinc-800_50]="selectedModel() !== model.id"
                    [class.text-zinc-400]="selectedModel() !== model.id"
                    [class.hover:border-zinc-700]="selectedModel() !== model.id"
                    [class.hover:bg-zinc-800_40]="selectedModel() !== model.id"
                  >
                    <div class="flex justify-between items-center mb-0.5 relative z-10">
                      <span class="font-medium group-hover:text-teal-300 transition-colors">{{ model.label }}</span>
                      <span class="text-[10px] opacity-70 bg-zinc-950/30 px-1.5 py-0.5 rounded border border-white/5">{{ model.dims }}d</span>
                    </div>
                    <div class="text-[10px] opacity-60 relative z-10">{{ model.desc }}</div>
                    
                    <!-- Selection Indicator -->
                    <div *ngIf="selectedModel() === model.id" class="absolute inset-0 bg-gradient-to-r from-teal-500/10 via-transparent to-transparent pointer-events-none"></div>
                  </button>
                </div>
             </div>

             <!-- Truncation -->
             <div>
                <div class="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-3 mb-2 px-1">Dimension Truncation</div>
                <div class="grid grid-cols-4 gap-1.5">
                  <button
                    *ngFor="let dim of truncateDims"
                    (click)="truncateDim.set(dim)"
                    class="py-1.5 rounded text-xs font-medium transition-all border relative overflow-hidden"
                    [class.bg-teal-500_20]="truncateDim() === dim"
                    [class.text-teal-300]="truncateDim() === dim"
                    [class.border-teal-500_30]="truncateDim() === dim"
                    [class.bg-zinc-900_50]="truncateDim() !== dim"
                    [class.text-zinc-500]="truncateDim() !== dim"
                    [class.border-zinc-800]="truncateDim() !== dim"
                    [class.hover:border-zinc-700]="truncateDim() !== dim"
                    [class.hover:text-zinc-300]="truncateDim() !== dim"
                  >
                    {{ dim === 'full' ? 'Full' : dim + 'd' }}
                  </button>
                </div>
             </div>
             
             <!-- Hybrid Slider -->
            <div *ngIf="searchMode() === 'hybrid'" class="pt-2 px-1">
                <div class="flex justify-between text-xs text-zinc-400 mb-2 font-medium">
                    <span>Vector Weight</span>
                    <span class="text-teal-400">{{ (vectorWeight() * 100).toFixed(0) }}%</span>
                </div>
                <div class="relative h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                    <div class="absolute top-0 bottom-0 left-0 bg-teal-500/50" [style.width.%]="vectorWeight() * 100"></div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        [ngModel]="vectorWeight()"
                        (ngModelChange)="vectorWeight.set($event)"
                        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Folder Scope Selector -->
      <div class="mb-3 shrink-0">
        <div class="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5 px-1">Index Scope</div>
        <div class="relative">
          <ng-icon name="lucideGlobe" *ngIf="indexScope() === 'global'" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-teal-500"></ng-icon>
          <ng-icon name="lucideFolder" *ngIf="indexScope() !== 'global'" class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-amber-500"></ng-icon>
          <select
            [ngModel]="indexScope()"
            (ngModelChange)="indexScope.set($event)"
            class="w-full h-9 pl-9 pr-3 rounded-md bg-zinc-900/60 border border-zinc-700/50 text-zinc-200 text-xs focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all appearance-none cursor-pointer"
          >
            <option value="global">Global (All Notes)</option>
            <option *ngFor="let f of folders()" [value]="f.id">{{ f.name }}</option>
          </select>
          <ng-icon name="lucideChevronDown" class="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"></ng-icon>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 mb-4 shrink-0">
        <button
          (click)="loadModel()"
          [disabled]="status() === 'loading-model' || status() === 'initializing'"
          class="flex-1 h-9 flex items-center justify-center text-xs font-medium rounded-md border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
          [class.bg-zinc-900]="true"
          [class.border-zinc-800]="true"
          [class.text-zinc-400]="true"
          [class.hover:bg-zinc-800]="true"
          [class.hover:text-zinc-200]="true"
          [class.hover:border-zinc-700]="true"
        >
          <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
          <ng-icon 
            [name]="status() === 'loading-model' ? 'lucideLoader2' : 'lucideCpu'" 
            class="w-3.5 h-3.5 mr-1.5 transition-colors"
            [class.animate-spin]="status() === 'loading-model'"
            [class.text-teal-500]="status() === 'loading-model'"
          ></ng-icon>
          Load Model
        </button>

        <button
          (click)="indexNotes()"
          [disabled]="status() !== 'ready'"
          class="flex-1 h-9 flex items-center justify-center text-xs font-medium rounded-md border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
          [class.bg-zinc-900]="true"
          [class.border-zinc-800]="true"
          [class.text-zinc-400]="true"
          [class.hover:bg-zinc-800]="true"
          [class.hover:text-zinc-200]="true"
          [class.hover:border-teal-500_30]="true"
        >
          <div class="absolute inset-0 bg-gradient-to-r from-transparent via-teal-500/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
           <ng-icon 
            [name]="status() === 'indexing' ? 'lucideLoader2' : 'lucideZap'" 
            class="w-3.5 h-3.5 mr-1.5 group-hover:text-teal-400 transition-colors"
            [class.animate-spin]="status() === 'indexing'"
            [class.text-teal-400]="status() === 'indexing'"
          ></ng-icon>
          Index (<span class="text-zinc-300 group-hover:text-teal-300 transition-colors">{{ stats().notes }}</span>)
        </button>
      </div>

      <!-- Results Area -->
      <div class="flex-1 overflow-y-auto min-h-0 custom-scrollbar pr-1">
        <!-- Error State -->
        <div *ngIf="error()" class="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 animate-in fade-in slide-in-from-top-2">
            <div class="flex items-center gap-2">
                <ng-icon name="lucideAlertCircle" class="w-4 h-4 shrink-0"></ng-icon>
                <span>{{ error() }}</span>
            </div>
        </div>

        <!-- Results List -->
        <div *ngIf="results().length > 0; else noResults" class="space-y-2 pb-4">
             <div class="flex items-center justify-between text-xs text-zinc-500 px-1 mb-2">
                <span>{{ results().length }} results</span>
                <span>{{ searchTime() }}ms</span>
            </div>
            
            <button
                *ngFor="let result of results()"
                class="w-full p-3 rounded-lg bg-zinc-950/30 border border-zinc-800/50 text-left hover:bg-gradient-to-br hover:from-zinc-900/80 hover:to-zinc-900/40 hover:border-teal-500/30 transition-all group animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden"
                (click)="handleResultClick(result)"
            >
                <div class="absolute inset-0 bg-teal-500/0 group-hover:bg-teal-500/5 transition-colors duration-300"></div>
                <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-teal-500/0 group-hover:bg-teal-500/50 transition-colors duration-300"></div>

                <div class="flex items-center justify-between mb-1.5 relative z-10">
                    <span class="text-sm font-medium text-zinc-300 group-hover:text-teal-200 transition-colors truncate">
                        {{ result.note_title }}
                    </span>
                    <span class="text-[10px] font-mono font-medium text-teal-600/80 shrink-0 ml-2 bg-teal-500/5 border border-teal-500/10 px-1.5 py-0.5 rounded group-hover:bg-teal-500/10 group-hover:text-teal-400 group-hover:border-teal-500/20 transition-all">
                        {{ (result.score * 100).toFixed(1) }}%
                    </span>
                </div>
                <p class="text-xs text-zinc-500 line-clamp-2 leading-relaxed group-hover:text-zinc-400 transition-colors relative z-10">
                    {{ result.chunk_text }}
                </p>
            </button>
        </div>

        <ng-template #noResults>
            <div class="flex flex-col items-center justify-center h-48 text-center text-zinc-500">
                <ng-container *ngIf="query() && status() === 'ready'; else emptyState">
                     <ng-icon name="lucideSearch" class="w-8 h-8 mb-3 opacity-20"></ng-icon>
                     <p class="text-sm">No matching notes found</p>
                 </ng-container>
                 <ng-template #emptyState>
                    <div class="p-6 rounded-full bg-zinc-900/30 border border-zinc-800/50 mb-4 ring-1 ring-zinc-800/50">
                        <ng-icon name="lucideMicrochip" class="w-8 h-8 text-teal-500/30"></ng-icon>
                    </div>
                    <p class="text-sm font-medium text-zinc-400 mb-1">Semantic Search Ready</p>
                    <p class="text-xs text-zinc-600 max-w-[200px]">Load a model to search your notes by meaning, not just keywords.</p>
                 </ng-template>
            </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #52525b; }
  `]
})
export class SearchPanelComponent implements OnInit {
  private searchService = inject(SemanticSearchService);

  // Signals
  status = signal<RagStatus>('idle');
  error = signal<string | null>(null);
  stats = signal<RagStats>({ notes: 0, chunks: 0 });
  query = signal('');
  results = signal<SearchResult[]>([]);
  searchTime = signal(0);

  // Config
  selectedModel = signal<ModelId>('mdbr-leaf');
  truncateDim = signal<TruncateDim>('full');
  searchMode = signal<SearchMode>('vector');
  vectorWeight = signal(0.7);
  showAdvanced = signal(false);
  embedMode = signal<EmbedMode>('typescript');

  // Indexing scope
  indexScope = signal<'global' | string>('global');
  folders = signal<Array<{ id: string; name: string }>>([]);

  // Constants
  readonly modes: { id: SearchMode, label: string, icon: string }[] = [
    { id: 'vector', label: 'Vector', icon: 'lucideZap' },
    { id: 'hybrid', label: 'Hybrid', icon: 'lucideLayers' },
    { id: 'raptor', label: 'RAPTOR', icon: 'lucideCpu' }
  ];

  readonly models: { id: ModelId, label: string, dims: number, desc: string }[] = [
    { id: 'mdbr-leaf', label: 'MDBR Leaf', dims: 256, desc: 'Fastest • TypeScript' },
    { id: 'bge-small', label: 'BGE-small', dims: 384, desc: 'Balanced • Rust' },
    { id: 'modernbert-base', label: 'ModernBERT', dims: 768, desc: 'Powerful • Rust' }
  ];

  readonly truncateDims: TruncateDim[] = ['full', '256', '128', '64'];

  // Computed
  statusDisplay = computed(() => {
    switch (this.status()) {
      case 'idle': return { icon: 'lucideCpu', text: 'Not initialized', color: 'text-zinc-500', spin: false };
      case 'initializing': return { icon: 'lucideLoader2', text: 'Initializing...', color: 'text-teal-400', spin: true };
      case 'loading-model': return { icon: 'lucideLoader2', text: 'Loading Model...', color: 'text-teal-400', spin: true };
      case 'ready': return { icon: 'lucideCheckCircle2', text: 'Ready', color: 'text-emerald-400', spin: false };
      case 'indexing': return { icon: 'lucideLoader2', text: 'Indexing...', color: 'text-teal-400', spin: true };
      case 'searching': return { icon: 'lucideLoader2', text: 'Searching...', color: 'text-teal-400', spin: true };
      case 'error': return { icon: 'lucideAlertCircle', text: 'Error', color: 'text-red-400', spin: false };
      default: return { icon: 'lucideCpu', text: 'Unknown', color: 'text-zinc-500', spin: false };
    }
  });

  constructor() {
    // Determine embed mode based on selected model
    effect(() => {
      const model = this.selectedModel();
      this.embedMode.set(model === 'mdbr-leaf' ? 'typescript' : 'rust');
    });
  }

  async ngOnInit() {
    // Load folders for scope selection
    try {
      const { getAllFolders } = await import('../../lib/nebula/operations');
      const allFolders = await getAllFolders();
      this.folders.set(allFolders.map(f => ({ id: f.id, name: f.name })));
    } catch (err) {
      console.warn('[SearchPanel] Failed to load folders:', err);
    }
    // Stats are loaded after indexing, not on init (avoids Cozo not-ready error)
  }

  toggleAdvanced() {
    this.showAdvanced.update(v => !v);
  }

  // Actions
  getModelLabel(id: ModelId): string {
    return this.models.find(m => m.id === id)?.label || id;
  }

  async loadModel() {
    this.status.set('loading-model');
    this.error.set(null);

    try {
      await this.searchService.initializeWorker();
      this.status.set('ready');
    } catch (err) {
      console.error('[SearchPanel] Failed to load model:', err);
      this.error.set(err instanceof Error ? err.message : 'Failed to load model');
      this.status.set('error');
    }
  }

  async indexNotes() {
    if (this.status() !== 'ready') return;

    this.status.set('indexing');
    this.error.set(null);

    try {
      const { getAllNotes, getNotesByFolder } = await import('../../lib/nebula/operations');
      const scope = this.indexScope();

      // Fetch notes based on selected scope
      let notes;
      if (scope === 'global') {
        notes = await getAllNotes();
      } else {
        notes = await getNotesByFolder(scope);
      }

      console.log(`[SearchPanel] Indexing ${notes.length} notes (scope: ${scope})`);

      // Pass to semantic search service
      await this.searchService.indexNotes(
        notes.map(n => ({
          id: n.id,
          narrativeId: (n as any).narrativeId ?? '',
          title: n.title ?? 'Untitled',
          content: n.content ?? ''
        }))
      );

      // Update stats after indexing
      const s = await this.searchService.getStats();
      this.stats.set({ ...s, notes: notes.length });
      this.status.set('ready');
    } catch (err) {
      console.error('[SearchPanel] Indexing failed:', err);
      this.error.set(err instanceof Error ? err.message : 'Indexing failed');
      this.status.set('error');
    }
  }

  async handleSearch() {
    if (!this.query().trim() || this.status() !== 'ready') return;

    this.status.set('searching');
    this.error.set(null);
    const startTime = performance.now();

    try {
      const searchResults = await this.searchService.search(this.query(), {
        k: 10,
        mode: this.searchMode() === 'raptor' ? 'collapsed' : 'leaves',
        scoped: true
      });

      // Map to component's SearchResult format
      const mapped: SearchResult[] = searchResults.map(r => ({
        note_id: r.noteId,
        note_title: r.noteTitle,
        chunk_text: r.chunkText,
        score: r.score,
        chunk_index: r.chunkIndex
      }));

      this.results.set(mapped);
      this.searchTime.set(Math.round(performance.now() - startTime));
      this.status.set('ready');
    } catch (err) {
      console.error('[SearchPanel] Search failed:', err);
      this.error.set(err instanceof Error ? err.message : 'Search failed');
      this.status.set('error');
    }
  }

  handleResultClick(result: SearchResult) {
    console.log('Navigating to note:', result.note_id);
    // TODO: Connect to navigation service
  }
}
