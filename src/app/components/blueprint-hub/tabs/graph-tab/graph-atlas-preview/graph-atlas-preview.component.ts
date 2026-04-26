import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Brain, Plus, Search, Wand2, Zap } from 'lucide-angular';
import { LucideAngularModule } from 'lucide-angular';

import type { RegisteredEntity } from '../../../../../lib/registry';
import type { EntitySuggestionProviderId } from '../../../../../lib/entity-suggestions/entity-suggestion.types';
import { ScopeService, type ResolvedScope } from '../../../../../lib/services/scope.service';
import { loadEmbeddingAtlasForScope } from './graph-embedding-atlas-loader';
import { buildEmbeddingQueryTrace, type EmbeddingAtlasData, type EmbeddingQueryTrace, type EmbeddingSourcePreview } from './graph-embedding-atlas';
import { GraphGalaxyCanvasComponent } from './graph-galaxy-canvas.component';
import {
    DEFAULT_GALAXY_SETTINGS,
    type GalaxyBackgroundMode,
    type GalaxyEdgeColorMode,
    type GalaxyEdgeMode,
    type GalaxyInputEdge,
    type GalaxyLabelMode,
    type GalaxyNodeDragMode,
    type GalaxyNodeShapeMode,
    type GalaxyRenderableNode,
    type GalaxyRenderSettings,
} from './graph-galaxy-engine';
import type { GraphLensMode } from '../graph-lens';

export interface AtlasPreviewEdge extends GalaxyInputEdge {}

@Component({
    selector: 'app-graph-atlas-preview',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, GraphGalaxyCanvasComponent],
    template: `
        <section class="relative h-full min-h-[520px] overflow-hidden rounded-none border border-white/5 bg-white/[0.02] shadow-[0_24px_80px_rgba(0,0,0,0.24)]" [attr.data-backdrop]="settings.backgroundMode">
            <div class="relative z-10 flex h-full min-h-[520px] flex-col p-px">
                <div class="pointer-events-none absolute left-5 right-5 top-5 z-30 flex items-start justify-between gap-3">
                    <div class="canvas-control-rail flex min-w-0 flex-wrap items-center gap-2 rounded-2xl px-2 py-1.5">
                        <div class="flex rounded-xl border border-white/10 bg-black/40 p-1">
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="atlasMode === 'entities'" [class.text-cyan-100]="atlasMode === 'entities'"
                                [class.text-zinc-500]="atlasMode !== 'entities'" (click)="setAtlasMode('entities')">Entities</button>
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="atlasMode === 'embeddings'" [class.text-cyan-100]="atlasMode === 'embeddings'"
                                [class.text-zinc-500]="atlasMode !== 'embeddings'" (click)="setAtlasMode('embeddings')">Embeddings</button>
                        </div>
                        <span class="rounded-full border border-cyan-400/15 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">{{ activeNodeCount() }} nodes</span>
                        <span class="rounded-full border border-violet-400/15 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-100">{{ activeEdgeCount() }} links</span>
                        <div class="flex rounded-xl border border-white/10 bg-black/40 p-1">
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="viewMode === '3d'" [class.text-cyan-100]="viewMode === '3d'"
                                [class.text-zinc-500]="viewMode !== '3d'" (click)="setViewMode('3d')">3D</button>
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="viewMode === 'map'" [class.text-cyan-100]="viewMode === 'map'"
                                [class.text-zinc-500]="viewMode !== 'map'" (click)="setViewMode('map')">Map</button>
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                            <button type="button" class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-cyan-400/20 hover:bg-cyan-500/10"
                                (click)="resetCamera()">Reset</button>
                            <button type="button" class="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-cyan-400/20 hover:bg-cyan-500/10"
                                (click)="fitCamera()">Fit</button>
                        </div>
                    </div>

                    <div class="flex shrink-0 items-start gap-2">
                        <div class="relative">
                            <button type="button"
                                class="canvas-glass-button rounded-xl px-3 py-1.5 text-xs font-semibold"
                                (click)="toggleLensMenu()">
                                {{ lensLabel() }} Lens
                            </button>
                            @if (lensMenuOpen) {
                            <div class="pointer-events-auto absolute right-0 top-10 w-44 rounded-2xl border border-white/10 bg-black/55 p-2 text-xs shadow-2xl backdrop-blur">
                                @for (mode of lensModes; track mode.id) {
                                <button type="button" class="lens-menu-button" [class.lens-menu-button-active]="lensMode === mode.id"
                                    (click)="chooseLens(mode.id)">
                                    {{ mode.label }}
                                </button>
                                }
                            </div>
                            }
                        </div>
                        <button type="button"
                            class="canvas-glass-button rounded-xl px-3 py-1.5 text-xs font-semibold"
                            (click)="toggleSettings()">
                            Settings
                        </button>
                    </div>
                </div>

                <div class="relative min-h-0 flex-1 overflow-hidden rounded-none border border-white/5 bg-black/20 p-px">
                    @if (activeNodeCount() === 0) {
                    <div class="flex h-full min-h-[430px] items-center justify-center rounded-none border border-dashed border-white/10 text-center">
                        <div>
                            <p class="text-lg font-semibold text-white">{{ atlasMode === 'entities' ? 'No entities yet' : 'No embedding source yet' }}</p>
                            <p class="mt-2 max-w-md text-sm leading-6 text-zinc-500">{{ atlasMode === 'entities' ? 'Add or extract entities and the atlas will start drawing the scope.' : 'Open a narrative with notes and the doc atlas will project its semantic shape.' }}</p>
                        </div>
                    </div>
                    } @else {
                    <app-graph-galaxy-canvas #galaxyCanvas class="block h-full min-h-0 w-full"
                        [entities]="activeNodes()" [edges]="activeEdges()" [settings]="settings" [selectedEntityId]="selectedEntityId"
                        [queryFocus]="canvasQueryFocus()" [viewMode]="viewMode"
                        (entitySelected)="onCanvasEntitySelected($event)" (entityHovered)="hoveredEntity = $event"></app-graph-galaxy-canvas>
                    @if (atlasMode === 'embeddings') {
                    <form class="absolute left-4 top-20 flex max-w-[min(620px,calc(100%-220px))] items-center gap-2 rounded-2xl border border-cyan-400/15 bg-black/55 p-1.5 shadow-2xl backdrop-blur"
                        (submit)="runAtlasQuery(); $event.preventDefault()">
                        <input type="text" class="h-9 min-w-[260px] flex-1 bg-transparent px-3 text-sm text-cyan-50 outline-none placeholder:text-zinc-500"
                            placeholder="Ask the atlas where an idea lives..." [value]="queryText()"
                            (input)="queryText.set($any($event.target).value)" />
                        <button type="submit" class="h-9 rounded-xl bg-cyan-500/15 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/25">
                            Trace
                        </button>
                        @if (queryTrace()) {
                        <button type="button" class="h-9 rounded-xl border border-white/10 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.06]"
                            (click)="clearAtlasQuery()">Clear</button>
                        }
                    </form>
                    @if (activePreview(); as preview) {
                    <div class="absolute bottom-4 right-4 max-w-[360px] rounded-2xl border border-white/10 bg-black/60 p-3 text-xs shadow-2xl backdrop-blur">
                        <div class="flex items-center justify-between gap-3">
                            <span class="truncate font-semibold text-white">{{ preview.label }}</span>
                            <span class="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-100">{{ preview.sourceType }}</span>
                        </div>
                        <p class="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">score {{ preview.score | number:'1.2-2' }}</p>
                        <p class="mt-2 line-clamp-3 leading-5 text-zinc-300">{{ preview.preview || 'No source preview available yet.' }}</p>
                    </div>
                    }
                    }
                    <div class="atlas-bottom-shelf absolute bottom-4 left-4 z-30 flex max-w-[min(760px,calc(100%-32px))] items-center gap-2">
                        <label class="atlas-canvas-search">
                            <lucide-icon [img]="SearchIcon" class="h-4 w-4 text-zinc-500"></lucide-icon>
                            <input type="text" placeholder="Search labels, aliases, or kinds" [ngModel]="atlasSearch"
                                (ngModelChange)="atlasSearchChange.emit($event)" />
                        </label>
                        <div class="atlas-canvas-actions">
                            <button type="button" class="atlas-canvas-action" (click)="addEntityRequested.emit()">
                                <lucide-icon [img]="PlusIcon" class="h-4 w-4"></lucide-icon>Add
                            </button>
                            <button type="button" class="atlas-canvas-action" [disabled]="isExtracting" (click)="extractRequested.emit()">
                                <lucide-icon [img]="WandIcon" class="h-4 w-4" [class.animate-pulse]="isExtracting"></lucide-icon>
                                {{ isExtracting ? extractionProgress.current + '/' + extractionProgress.total : 'Extract' }}
                            </button>
                            <button type="button" class="atlas-canvas-action scan-action" [disabled]="isScanning" (click)="scanRequested.emit('fst')">
                                <lucide-icon [img]="ZapIcon" class="h-4 w-4" [class.animate-pulse]="activeProvider === 'fst'"></lucide-icon>
                                {{ activeProvider === 'fst' ? 'Scanning' : 'Scan' }}
                            </button>
                            <button type="button" class="atlas-canvas-action gliner-action" [disabled]="isScanning" (click)="scanRequested.emit('gliner_local')">
                                <lucide-icon [img]="BrainIcon" class="h-4 w-4" [class.animate-pulse]="activeProvider === 'gliner_local'"></lucide-icon>
                                GLiNER
                            </button>
                        </div>
                    </div>
                    @if (settingsOpen) {
                    <div class="settings-float absolute right-4 top-14 w-[320px] rounded-2xl border border-white/10 p-3 text-xs text-zinc-300">
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" class="galaxy-control-button" (click)="cycleLabelMode()">Labels<span>{{ settings.labelMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleEdgeMode()">Edges<span>{{ settings.edgeMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleEdgeColorMode()">Color<span>{{ settings.edgeColorMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleParticles()">Flow<span>{{ settings.particleFlow ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleNodeDragMode()">Drag<span>{{ settings.nodeDragMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleClickFocus()">Focus<span>{{ settings.clickFocus ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleNodeShape()">Shape<span>{{ settings.nodeShape }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleAutoRotate()">Rotate<span>{{ settings.autoRotate ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleBackgroundMode()">Backdrop<span>{{ backgroundLabel() }}</span></button>
                        </div>
                        <label class="mt-3 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Glow</span><span>{{ settings.glow | number:'1.1-1' }}</span></span>
                            <input type="range" min="0" max="1.8" step="0.05" [value]="settings.glow" class="galaxy-slider" (input)="setGlow($any($event.target).value)" />
                        </label>
                        <label class="mt-2 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Distance</span><span>{{ settings.nodeDistance | number:'1.1-1' }}</span></span>
                            <input type="range" min="0.15" max="3.2" step="0.05" [value]="settings.nodeDistance" class="galaxy-slider" (input)="setNodeDistance($any($event.target).value)" />
                        </label>
                        <label class="mt-2 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Edge length</span><span>{{ settings.edgeLength | number:'1.1-1' }}</span></span>
                            <input type="range" min="0.15" max="3.4" step="0.05" [value]="settings.edgeLength" class="galaxy-slider" (input)="setEdgeLength($any($event.target).value)" />
                        </label>
                        <label class="mt-2 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Edge width</span><span>{{ settings.edgeWidth | number:'1.1-1' }}</span></span>
                            <input type="range" min="0.2" max="1.4" step="0.05" [value]="settings.edgeWidth" class="galaxy-slider" (input)="setEdgeWidth($any($event.target).value)" />
                        </label>
                        <label class="mt-2 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Curve</span><span>{{ settings.edgeCurveStrength | number:'1.1-1' }}</span></span>
                            <input type="range" min="0.35" max="3.2" step="0.05" [value]="settings.edgeCurveStrength" class="galaxy-slider" (input)="setCurveStrength($any($event.target).value)" />
                        </label>
                        @if (settings.particleFlow) {
                        <div class="mt-3 border-t border-white/10 pt-3">
                            <label class="block">
                                <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Particle size</span><span>{{ settings.particleSize | number:'1.1-1' }}</span></span>
                                <input type="range" min="0.35" max="2.6" step="0.05" [value]="settings.particleSize" class="galaxy-slider" (input)="setParticleSize($any($event.target).value)" />
                            </label>
                            <label class="mt-2 block">
                                <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Particle speed</span><span>{{ settings.particleSpeed | number:'1.1-1' }}</span></span>
                                <input type="range" min="0.2" max="3" step="0.05" [value]="settings.particleSpeed" class="galaxy-slider" (input)="setParticleSpeed($any($event.target).value)" />
                            </label>
                            <label class="mt-2 block">
                                <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Particle opacity</span><span>{{ settings.particleOpacity | number:'1.1-1' }}</span></span>
                                <input type="range" min="0.1" max="1" step="0.05" [value]="settings.particleOpacity" class="galaxy-slider" (input)="setParticleOpacity($any($event.target).value)" />
                            </label>
                        </div>
                        }
                    </div>
                    }
                    }
                </div>
            </div>
        </section>
    `,
    styles: [`
        :host section::before { content: ''; pointer-events: none; position: absolute; inset: 0; opacity: 0; transition: opacity 160ms ease, background 160ms ease; }
        :host section[data-backdrop="nebula"]::before { opacity: 1; background: radial-gradient(circle at 18% 20%, rgba(20,184,166,0.09), transparent 32%), radial-gradient(circle at 82% 20%, rgba(153,27,210,0.11), transparent 30%); }
        :host section[data-backdrop="grid"]::before { opacity: 1; background: radial-gradient(circle at 50% 50%, rgba(20,184,166,0.045), transparent 42%); }
        .galaxy-control-button {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 2px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.035);
            padding: 7px 8px;
            text-align: left;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: rgb(212 212 216);
            transition: border-color 160ms ease, background 160ms ease;
        }

        .galaxy-control-button:hover {
            border-color: rgba(34, 211, 238, 0.28);
            background: rgba(34, 211, 238, 0.10);
        }

        .galaxy-control-button span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgb(165 243 252);
            letter-spacing: 0;
            text-transform: none;
        }

        .galaxy-slider {
            width: 100%;
            accent-color: rgb(34 211 238);
        }

        .canvas-control-rail { pointer-events: none; background: transparent; box-shadow: none; }
        .canvas-control-rail button, .canvas-glass-button, .settings-float button, .settings-float input, .atlas-bottom-shelf, .atlas-bottom-shelf * { pointer-events: auto; }

        .canvas-glass-button {
            border: 1px solid rgba(255, 255, 255, 0.10);
            background: rgba(0, 0, 0, 0.24);
            color: rgb(228 228 231);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
            backdrop-filter: blur(8px);
            transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
        }

        .settings-float { pointer-events: none; background: transparent; box-shadow: none; }

        .canvas-glass-button:hover {
            border-color: rgba(45, 212, 191, 0.24);
            background: rgba(20, 184, 166, 0.10);
            color: rgb(204 251 241);
        }

        .lens-menu-button {
            display: flex;
            width: 100%;
            align-items: center;
            justify-content: space-between;
            border-radius: 10px;
            padding: 8px 10px;
            color: rgb(161 161 170);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            transition: background 140ms ease, color 140ms ease;
        }

        .lens-menu-button:hover,
        .lens-menu-button-active {
            background: rgba(20, 184, 166, 0.12);
            color: rgb(153 246 228);
        }

        .atlas-bottom-shelf {
            filter: drop-shadow(0 16px 30px rgba(0, 0, 0, 0.34));
        }

        .atlas-canvas-search {
            display: flex;
            min-height: 38px;
            min-width: min(360px, 42vw);
            align-items: center;
            gap: 9px;
            border: 1px solid rgba(45, 212, 191, 0.16);
            border-radius: 999px;
            background: rgba(3, 8, 13, 0.72);
            padding: 0 13px;
            backdrop-filter: blur(12px);
        }

        .atlas-canvas-search input {
            min-width: 0;
            flex: 1;
            background: transparent;
            color: rgb(236 254 255);
            font-size: 13px;
            outline: none;
        }

        .atlas-canvas-search input::placeholder {
            color: rgb(113 113 122);
        }

        .atlas-canvas-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            border: 1px solid rgba(45, 212, 191, 0.13);
            border-radius: 999px;
            background: rgba(3, 8, 13, 0.68);
            padding: 4px;
            backdrop-filter: blur(12px);
        }

        .atlas-canvas-action {
            display: inline-flex;
            min-height: 30px;
            align-items: center;
            justify-content: center;
            gap: 5px;
            border-radius: 999px;
            padding: 0 10px;
            color: rgb(207 250 254);
            font-size: 11px;
            font-weight: 800;
            transition: background 140ms ease, color 140ms ease, opacity 140ms ease;
        }

        .atlas-canvas-action:hover {
            background: rgba(20, 184, 166, 0.13);
            color: rgb(240 253 250);
        }

        .atlas-canvas-action:disabled {
            cursor: default;
            opacity: 0.58;
        }

        .atlas-canvas-action.scan-action {
            color: rgb(253 230 138);
        }

        .atlas-canvas-action.gliner-action {
            color: rgb(221 214 254);
        }

        @media (max-width: 900px) {
            .atlas-bottom-shelf {
                right: 4px;
                flex-wrap: wrap;
            }

            .atlas-canvas-search {
                min-width: min(420px, calc(100vw - 64px));
            }
        }
    `],
})
export class GraphAtlasPreviewComponent {
    private readonly scopeService = inject(ScopeService);
    private atlasLoadToken = 0;

    @Input() entities: GalaxyRenderableNode[] = [];
    @Input() edges: AtlasPreviewEdge[] = [];
    @Input() sourceLabel = 'registry graph';
    @Input() lensMode: GraphLensMode = 'narrative';
    @Input() atlasSearch = '';
    @Input() isExtracting = false;
    @Input() extractionProgress: { current: number; total: number } = { current: 0, total: 0 };
    @Input() isScanning = false;
    @Input() activeProvider: EntitySuggestionProviderId | null = null;
    @Output() entitySelected = new EventEmitter<RegisteredEntity>();
    @Output() addEntityRequested = new EventEmitter<void>();
    @Output() extractRequested = new EventEmitter<void>();
    @Output() scanRequested = new EventEmitter<EntitySuggestionProviderId>();
    @Output() styleRequested = new EventEmitter<void>();
    @Output() lensModeChange = new EventEmitter<GraphLensMode>();
    @Output() atlasSearchChange = new EventEmitter<string>();
    @ViewChild('galaxyCanvas') private galaxyCanvas?: GraphGalaxyCanvasComponent;

    viewMode: '3d' | 'map' = '3d';
    atlasMode: 'entities' | 'embeddings' = 'entities';
    settings: GalaxyRenderSettings = { ...DEFAULT_GALAXY_SETTINGS };
    settingsOpen = false;
    lensMenuOpen = false;
    selectedEntityId: string | null = null;
    hoveredEntity: GalaxyRenderableNode | null = null;
    queryText = signal('');
    queryTrace = signal<EmbeddingQueryTrace | null>(null);
    embeddingAtlas = signal<EmbeddingAtlasData>({ nodes: [], edges: [], sourceLabel: 'doc vectors', searchIndex: [] });
    readonly BrainIcon = Brain;
    readonly PlusIcon = Plus;
    readonly SearchIcon = Search;
    readonly WandIcon = Wand2;
    readonly ZapIcon = Zap;
    readonly lensModes: { id: GraphLensMode; label: string }[] = [
        { id: 'global', label: 'Global' },
        { id: 'narrative', label: 'Narrative' },
        { id: 'note', label: 'Note' },
        { id: 'multiNote', label: 'Compare' },
    ];

    constructor() {
        effect(() => {
            const scope = this.scopeService.resolvedScope();
            void this.refreshEmbeddingAtlas(scope);
        });
    }

    setViewMode(mode: '3d' | 'map'): void {
        this.viewMode = mode;
    }

    setAtlasMode(mode: 'entities' | 'embeddings'): void {
        this.atlasMode = mode;
        this.selectedEntityId = null;
        this.hoveredEntity = null;
    }

    toggleSettings(): void {
        this.settingsOpen = !this.settingsOpen;
        if (this.settingsOpen) this.lensMenuOpen = false;
    }

    toggleLensMenu(): void {
        this.lensMenuOpen = !this.lensMenuOpen;
        if (this.lensMenuOpen) this.settingsOpen = false;
    }

    chooseLens(mode: GraphLensMode): void {
        this.lensModeChange.emit(mode);
        this.lensMenuOpen = false;
    }

    lensLabel(): string {
        return this.lensModes.find((mode) => mode.id === this.lensMode)?.label ?? 'Narrative';
    }

    onCanvasEntitySelected(node: GalaxyRenderableNode): void {
        this.selectedEntityId = this.selectedEntityId === node.id ? null : node.id;
    }

    runAtlasQuery(): void {
        this.atlasMode = 'embeddings';
        const trace = buildEmbeddingQueryTrace(this.queryText(), this.embeddingAtlas());
        this.queryTrace.set(trace);
        this.selectedEntityId = trace?.queryNode.id ?? null;
        if (trace) {
            setTimeout(() => this.galaxyCanvas?.focusEntity(trace.queryNode.id), 40);
        }
    }

    clearAtlasQuery(): void {
        this.queryTrace.set(null);
        this.selectedEntityId = null;
    }

    resetCamera(): void {
        this.galaxyCanvas?.resetCamera();
    }

    fitCamera(): void {
        this.galaxyCanvas?.fitToGraph();
    }

    cycleLabelMode(): void {
        const modes: GalaxyLabelMode[] = ['hover', 'selected', 'important', 'always', 'off'];
        this.updateSettings({ labelMode: modes[(modes.indexOf(this.settings.labelMode) + 1) % modes.length] });
    }

    cycleEdgeMode(): void {
        const modes: GalaxyEdgeMode[] = ['curved', 'straight', 'hidden'];
        this.updateSettings({ edgeMode: modes[(modes.indexOf(this.settings.edgeMode) + 1) % modes.length] });
    }

    cycleEdgeColorMode(): void {
        const modes: GalaxyEdgeColorMode[] = ['cyan', 'entityBlend', 'confidence', 'muted'];
        this.updateSettings({ edgeColorMode: modes[(modes.indexOf(this.settings.edgeColorMode) + 1) % modes.length] });
    }

    toggleParticles(): void {
        this.updateSettings({ particleFlow: !this.settings.particleFlow });
    }

    cycleNodeDragMode(): void {
        const modes: GalaxyNodeDragMode[] = ['stretch', 'force', 'camera'];
        this.updateSettings({ nodeDragMode: modes[(modes.indexOf(this.settings.nodeDragMode) + 1) % modes.length] });
    }

    toggleClickFocus(): void {
        const clickFocus = !this.settings.clickFocus;
        this.updateSettings({ clickFocus });
        if (!clickFocus) this.galaxyCanvas?.clearCameraFocus();
    }

    cycleNodeShape(): void {
        const modes: GalaxyNodeShapeMode[] = ['halo', 'sphere'];
        this.updateSettings({ nodeShape: modes[(modes.indexOf(this.settings.nodeShape) + 1) % modes.length] });
    }

    toggleAutoRotate(): void {
        this.updateSettings({ autoRotate: !this.settings.autoRotate });
    }

    cycleBackgroundMode(): void {
        const modes: GalaxyBackgroundMode[] = ['nebula', 'grid', 'quiet', 'void'];
        this.updateSettings({ backgroundMode: modes[(modes.indexOf(this.settings.backgroundMode) + 1) % modes.length] });
    }

    backgroundLabel(): string {
        const labels: Record<GalaxyBackgroundMode, string> = {
            nebula: 'nebula',
            grid: 'grid',
            quiet: 'quiet',
            void: 'void',
        };
        return labels[this.settings.backgroundMode];
    }

    setGlow(value: string): void {
        this.updateSettings({ glow: Number(value) });
    }

    setNodeDistance(value: string): void {
        this.updateSettings({ nodeDistance: Number(value) });
    }

    setEdgeLength(value: string): void {
        this.updateSettings({ edgeLength: Number(value) });
    }

    setEdgeWidth(value: string): void {
        this.updateSettings({ edgeWidth: Number(value) });
    }

    setCurveStrength(value: string): void {
        this.updateSettings({ edgeCurveStrength: Number(value) });
    }

    setParticleSize(value: string): void {
        this.updateSettings({ particleSize: Number(value) });
    }

    setParticleSpeed(value: string): void {
        this.updateSettings({ particleSpeed: Number(value) });
    }

    setParticleOpacity(value: string): void {
        this.updateSettings({ particleOpacity: Number(value) });
    }

    activeNodes(): GalaxyRenderableNode[] {
        if (this.atlasMode === 'entities') return this.entities;
        const trace = this.queryTrace();
        return trace ? [trace.queryNode, ...this.embeddingAtlas().nodes] : this.embeddingAtlas().nodes;
    }

    activeEdges(): AtlasPreviewEdge[] {
        if (this.atlasMode === 'entities') return this.edges;
        const trace = this.queryTrace();
        return trace ? [...trace.edges, ...this.embeddingAtlas().edges] : this.embeddingAtlas().edges;
    }

    activeNodeCount(): number {
        return this.activeNodes().length;
    }

    activeEdgeCount(): number {
        return this.activeEdges().length;
    }

    canvasQueryFocus() {
        const trace = this.queryTrace();
        return trace ? {
            queryNodeId: trace.queryNode.id,
            primaryNodeIds: trace.primaryIds,
            secondaryNodeIds: trace.secondaryIds,
            edgeIds: trace.edgeIds,
        } : null;
    }

    activePreview(): EmbeddingSourcePreview | null {
        if (this.atlasMode !== 'embeddings') return null;
        const trace = this.queryTrace();
        const node = this.hoveredEntity || (this.selectedEntityId ? this.activeNodes().find((item) => item.id === this.selectedEntityId) : null);
        if (!trace || !node) return null;
        if (node.id === trace.queryNode.id) {
            return { nodeId: node.id, label: 'Query star', score: 1, sourceType: 'query', preview: trace.query };
        }
        return trace.previews.find((preview) => preview.nodeId === node.id) ?? null;
    }

    private updateSettings(patch: Partial<GalaxyRenderSettings>): void {
        this.settings = { ...this.settings, ...patch };
    }

    private async refreshEmbeddingAtlas(scope: ResolvedScope): Promise<void> {
        const token = ++this.atlasLoadToken;
        const atlas = await loadEmbeddingAtlasForScope(scope);
        if (token === this.atlasLoadToken) {
            this.embeddingAtlas.set(atlas);
            this.queryTrace.set(buildEmbeddingQueryTrace(this.queryText(), atlas));
        }
    }
}
