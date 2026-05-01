import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Plus, Search, Zap } from 'lucide-angular';
import { LucideAngularModule } from 'lucide-angular';

import { entitySourceSystem, type RegisteredEntity } from '../../../../../lib/registry';
import type { EntitySuggestionProviderId } from '../../../../../lib/entity-suggestions/entity-suggestion.types';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';
import { ScopeService, type ResolvedScope } from '../../../../../lib/services/scope.service';
import { PhoenixUiApiService, type SearchScope } from '../../../../../services/phoenix-ui-api.service';
import type { PhoenixGraphDeltaBinaryResult } from '../../../../../services/phoenix-wasm.service';
import { BlueprintHubService } from '../../../blueprint-hub.service';
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
    type GalaxyLayoutMode,
    type GalaxyNodeDragMode,
    type GalaxyNodeShapeMode,
    type GalaxyRenderableNode,
    type GalaxyRenderSettings,
} from './graph-galaxy-engine';
import type { GraphLensMode } from '../graph-lens';

export interface AtlasPreviewEdge extends GalaxyInputEdge {}

interface ActiveAtlasGraph {
    mode: AtlasMode;
    entities: GalaxyRenderableNode[];
    edges: AtlasPreviewEdge[];
    atlas: EmbeddingAtlasData;
    trace: EmbeddingQueryTrace | null;
    graphInventory: GraphInventory;
    graphKindFilter: string;
    nodes: GalaxyRenderableNode[];
    graphEdges: AtlasPreviewEdge[];
}

type AtlasMode = 'entities' | 'graph' | 'embeddings';

interface GraphInventory {
    nodes: GalaxyRenderableNode[];
    edges: AtlasPreviewEdge[];
    kindCounts: Array<{ kind: string; count: number }>;
    sourceLabel: string;
}

const EMPTY_GRAPH_INVENTORY: GraphInventory = { nodes: [], edges: [], kindCounts: [], sourceLabel: 'graph inventory' };

@Component({
    selector: 'app-graph-atlas-preview',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, GraphGalaxyCanvasComponent],
    template: `
        <section class="atlas-preview-surface relative h-full min-h-[520px] overflow-hidden rounded-none border border-white/5 bg-[#02040a] shadow-[0_24px_80px_rgba(0,0,0,0.24)]" [attr.data-backdrop]="settings.backgroundMode">
            <div class="relative z-10 flex h-full min-h-[520px] flex-col p-px">
                <div class="pointer-events-none absolute left-5 right-5 top-5 z-30 flex items-start justify-between gap-3">
                    <div class="canvas-control-rail flex min-w-0 flex-wrap items-center gap-2 rounded-2xl px-2 py-1.5">
                        <div class="flex rounded-xl border border-white/10 bg-black/40 p-1">
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="atlasMode === 'entities'" [class.text-cyan-100]="atlasMode === 'entities'"
                                [class.text-zinc-500]="atlasMode !== 'entities'" (click)="setAtlasMode('entities')">Entities</button>
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-cyan-500/15]="atlasMode === 'graph'" [class.text-cyan-100]="atlasMode === 'graph'"
                                [class.text-zinc-500]="atlasMode !== 'graph'" (click)="setAtlasMode('graph')">Graph</button>
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
                        @if (atlasMode === 'embeddings') {
                        <div class="flex rounded-xl border border-white/10 bg-black/40 p-1">
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-violet-500/20]="settings.layoutMode === 'hybridSpace'" [class.text-violet-100]="settings.layoutMode === 'hybridSpace'"
                                [class.text-zinc-500]="settings.layoutMode !== 'hybridSpace'" (click)="setLayoutMode('hybridSpace')">Hybrid</button>
                            <button type="button" class="rounded-lg px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
                                [class.bg-violet-500/20]="settings.layoutMode === 'multiGalaxy'" [class.text-violet-100]="settings.layoutMode === 'multiGalaxy'"
                                [class.text-zinc-500]="settings.layoutMode !== 'multiGalaxy'" (click)="setLayoutMode('multiGalaxy')">Multi</button>
                        </div>
                        }
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

                <div class="atlas-canvas-surface relative min-h-0 flex-1 overflow-hidden rounded-none border border-white/5 bg-[#02040a] p-px">
                    @if (activeNodeCount() === 0) {
                    <div class="flex h-full min-h-[430px] items-center justify-center rounded-none border border-dashed border-white/10 text-center">
                        <div>
                            <p class="text-lg font-semibold text-white">{{ emptyTitle() }}</p>
                            <p class="mt-2 max-w-md text-sm leading-6 text-zinc-500">{{ emptyMessage() }}</p>
                        </div>
                    </div>
                    } @else {
                    <app-graph-galaxy-canvas #galaxyCanvas class="block h-full min-h-0 w-full"
                        [entities]="activeNodes()" [edges]="activeEdges()" [settings]="settings" [selectedEntityId]="selectedEntityId"
                        [queryFocus]="canvasQueryFocus()" [viewMode]="viewMode" [sourceMode]="atlasMode" [surfaceActive]="isAtlasSurfaceActive()"
                        (entitySelected)="onCanvasEntitySelected($event)" (entityHovered)="hoveredEntity = $event"></app-graph-galaxy-canvas>
                    @if (atlasMode === 'graph') {
                    <div class="absolute left-4 top-20 flex max-w-[min(760px,calc(100%-220px))] flex-wrap items-center gap-2 rounded-2xl border border-cyan-400/15 bg-black/55 p-2 shadow-2xl backdrop-blur">
                        <button type="button" class="graph-kind-chip" [class.graph-kind-chip-active]="graphKindFilter() === 'all'" (click)="setGraphKindFilter('all')">
                            All <span>{{ graphInventory().nodes.length }}</span>
                        </button>
                        @for (kind of graphKindCounts(); track kind.kind) {
                        <button type="button" class="graph-kind-chip" [class.graph-kind-chip-active]="graphKindFilter() === kind.kind" (click)="setGraphKindFilter(kind.kind)">
                            {{ kind.kind }} <span>{{ kind.count }}</span>
                        </button>
                        }
                    </div>
                    }
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
                            <button type="button" class="atlas-canvas-action scan-action" [disabled]="isScanning" (click)="scanRequested.emit()">
                                <lucide-icon [img]="ZapIcon" class="h-4 w-4" [class.animate-pulse]="isScanning"></lucide-icon>
                                {{ isScanning ? 'Scanning' : 'Scan' }}
                            </button>
                        </div>
                    </div>
                    @if (settingsOpen) {
                    <div class="settings-float absolute right-4 top-14 w-[320px] rounded-2xl border border-white/10 p-3 text-xs text-zinc-300">
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" class="galaxy-control-button" (click)="cycleLabelMode()">Labels<span>{{ settings.labelMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleEdgeMode()">Edges<span>{{ settings.edgeMode }}</span></button>
                          <button type="button" class="galaxy-control-button" (click)="cycleEdgeColorMode()">Palette<span>{{ edgeColorLabel() }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleParticles()">Flow<span>{{ settings.particleFlow ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleNodeDragMode()">Drag<span>{{ settings.nodeDragMode }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleClickFocus()">Focus<span>{{ settings.clickFocus ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleNodeShape()">Shape<span>{{ settings.nodeShape }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="toggleAutoRotate()">Rotate<span>{{ settings.autoRotate ? 'on' : 'off' }}</span></button>
                            <button type="button" class="galaxy-control-button" (click)="cycleBackgroundMode()">Backdrop<span>{{ backgroundLabel() }}</span></button>
                            @if (settings.layoutMode === 'hybridSpace') {
                            <button type="button" class="galaxy-control-button" (click)="toggleHybridShell()">Shell<span>{{ settings.hybridShellVisible ? 'on' : 'off' }}</span></button>
                            }
                        </div>
                        @if (settings.layoutMode === 'hybridSpace' && settings.hybridShellVisible) {
                        <label class="mt-3 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Shell opacity</span><span>{{ settings.hybridShellOpacity | number:'1.2-2' }}</span></span>
                            <input type="range" min="0" max="1" step="0.02" [value]="settings.hybridShellOpacity" class="galaxy-slider" (input)="setHybridShellOpacity($any($event.target).value)" />
                        </label>
                        }
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
                              <input type="range" min="0.15" max="1.1" step="0.05" [value]="settings.edgeWidth" class="galaxy-slider" (input)="setEdgeWidth($any($event.target).value)" />
                        </label>
                        <label class="mt-2 block">
                            <span class="flex justify-between text-[10px] uppercase tracking-[0.16em] text-zinc-500"><span>Curve</span><span>{{ settings.edgeCurveStrength | number:'1.1-1' }}</span></span>
                            <input type="range" min="0.25" max="1.2" step="0.05" [value]="settings.edgeCurveStrength" class="galaxy-slider" (input)="setCurveStrength($any($event.target).value)" />
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
        .atlas-preview-surface {
            color-scheme: dark;
            background:
                radial-gradient(circle at 18% 20%, rgba(20,184,166,0.07), transparent 32%),
                radial-gradient(circle at 82% 20%, rgba(153,27,210,0.08), transparent 30%),
                #02040a;
        }

        .atlas-canvas-surface {
            background:
                radial-gradient(circle at 50% 48%, rgba(34, 211, 238, 0.04), transparent 44%),
                #02040a;
        }

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

        .graph-kind-chip {
            display: inline-flex;
            min-height: 28px;
            align-items: center;
            gap: 6px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.035);
            padding: 0 9px;
            color: rgb(161 161 170);
            font-size: 10px;
            font-weight: 900;
            letter-spacing: 0.10em;
            text-transform: uppercase;
            transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
        }

        .graph-kind-chip span {
            color: rgb(103 232 249);
            letter-spacing: 0;
        }

        .graph-kind-chip:hover,
        .graph-kind-chip-active {
            border-color: rgba(45, 212, 191, 0.28);
            background: rgba(20, 184, 166, 0.12);
            color: rgb(204 251 241);
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
            border: 1px solid rgba(168, 85, 247, 0.32);
            background: rgba(126, 34, 206, 0.22);
            color: rgb(237 233 254);
            box-shadow: 0 0 22px rgba(168, 85, 247, 0.13);
        }

        .atlas-canvas-action.scan-action:hover {
            background: rgba(147, 51, 234, 0.34);
            color: rgb(250 245 255);
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
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly hubService = inject(BlueprintHubService);
    private atlasLoadToken = 0;
    private graphLoadToken = 0;
    private activeGraphCache: ActiveAtlasGraph | null = null;

    @Input() entities: GalaxyRenderableNode[] = [];
    @Input() edges: AtlasPreviewEdge[] = [];
    @Input() sourceLabel = 'registry graph';
    @Input() lensMode: GraphLensMode = 'narrative';
    @Input() atlasSearch = '';
    @Input() isScanning = false;
    @Input() activeProvider: EntitySuggestionProviderId | null = null;
    @Output() entitySelected = new EventEmitter<RegisteredEntity>();
    @Output() addEntityRequested = new EventEmitter<void>();
    @Output() scanRequested = new EventEmitter<void>();
    @Output() styleRequested = new EventEmitter<void>();
    @Output() lensModeChange = new EventEmitter<GraphLensMode>();
    @Output() atlasSearchChange = new EventEmitter<string>();
    @ViewChild('galaxyCanvas') private galaxyCanvas?: GraphGalaxyCanvasComponent;

    viewMode: '3d' | 'map' = '3d';
    atlasMode: AtlasMode = 'entities';
    settings: GalaxyRenderSettings = { ...DEFAULT_GALAXY_SETTINGS };
    settingsOpen = false;
    lensMenuOpen = false;
    selectedEntityId: string | null = null;
    hoveredEntity: GalaxyRenderableNode | null = null;
    queryText = signal('');
    queryTrace = signal<EmbeddingQueryTrace | null>(null);
    embeddingAtlas = signal<EmbeddingAtlasData>({ nodes: [], edges: [], sourceLabel: 'doc vectors', searchIndex: [] });
    graphInventory = signal<GraphInventory>(EMPTY_GRAPH_INVENTORY);
    graphKindFilter = signal('all');
    graphKindCounts = computed(() => this.graphInventory().kindCounts.slice(0, 10));
    readonly PlusIcon = Plus;
    readonly SearchIcon = Search;
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
            void this.refreshGraphInventory(scope);
        });
    }

    setViewMode(mode: '3d' | 'map'): void {
        this.viewMode = mode;
    }

    setAtlasMode(mode: AtlasMode): void {
        this.atlasMode = mode;
        this.selectedEntityId = null;
        this.hoveredEntity = null;
        if (mode !== 'embeddings' && this.settings.layoutMode !== 'single') {
            this.updateSettings({ layoutMode: 'single' });
        } else if (mode === 'embeddings' && this.settings.layoutMode === 'single') {
            this.updateSettings({ layoutMode: 'hybridSpace' });
        }
    }

    setGraphKindFilter(kind: string): void {
        this.graphKindFilter.set(kind);
        this.selectedEntityId = null;
        this.hoveredEntity = null;
    }

    setLayoutMode(mode: GalaxyLayoutMode): void {
        if (mode !== 'single' && this.atlasMode !== 'embeddings') return;
        this.updateSettings({ layoutMode: mode });
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
        const modes: GalaxyEdgeColorMode[] = ['entityBlend', 'aqua', 'orchid', 'gold', 'confidence', 'muted'];
        const current = this.settings.edgeColorMode === 'cyan' ? 'aqua' : this.settings.edgeColorMode;
        this.updateSettings({ edgeColorMode: modes[(modes.indexOf(current) + 1) % modes.length] });
    }

    edgeColorLabel(): string {
        const labels: Record<GalaxyEdgeColorMode, string> = {
            entityBlend: 'entity',
            aqua: 'aqua',
            orchid: 'orchid',
            gold: 'gold',
            confidence: 'score',
            muted: 'muted',
            cyan: 'aqua',
        };
        return labels[this.settings.edgeColorMode];
    }

    toggleParticles(): void {
        this.updateSettings({ particleFlow: !this.settings.particleFlow });
    }

    cycleNodeDragMode(): void {
        const modes: GalaxyNodeDragMode[] = ['stretch', 'force', 'pin', 'camera'];
        this.updateSettings({ nodeDragMode: modes[(modes.indexOf(this.settings.nodeDragMode) + 1) % modes.length] });
    }

    toggleClickFocus(): void {
        const clickFocus = !this.settings.clickFocus;
        this.updateSettings({ clickFocus });
        if (!clickFocus) this.galaxyCanvas?.clearCameraFocus();
    }

    cycleNodeShape(): void {
        const modes: GalaxyNodeShapeMode[] = ['atom', 'halo', 'sphere'];
        this.updateSettings({ nodeShape: modes[(modes.indexOf(this.settings.nodeShape) + 1) % modes.length] });
    }

    toggleAutoRotate(): void {
        this.updateSettings({ autoRotate: !this.settings.autoRotate });
    }

    toggleHybridShell(): void {
        this.updateSettings({ hybridShellVisible: !this.settings.hybridShellVisible });
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

    setHybridShellOpacity(value: string): void {
        this.updateSettings({ hybridShellOpacity: Number(value) });
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
        return this.activeGraph().nodes;
    }

    activeEdges(): AtlasPreviewEdge[] {
        return this.activeGraph().graphEdges;
    }

    activeNodeCount(): number {
        return this.activeNodes().length;
    }

    activeEdgeCount(): number {
        return this.activeEdges().length;
    }

    isAtlasSurfaceActive(): boolean {
        return this.activeNodeCount() > 0
            && this.hubService.activeTab() === 'graph'
            && (this.hubService.isPageMode() || this.hubService.isHubOpen());
    }

    emptyTitle(): string {
        if (this.atlasMode === 'graph') return 'No graph inventory yet';
        return this.atlasMode === 'entities' ? 'No entities yet' : 'No embedding source yet';
    }

    emptyMessage(): string {
        if (this.atlasMode === 'graph') return 'Run Atlas Command or rebuild the graph lane, then this view will show leaves, mentions, entities, and graph edges.';
        return this.atlasMode === 'entities'
            ? 'Add or extract entities and the atlas will start drawing the scope.'
            : 'Open a narrative with notes and the doc atlas will project its semantic shape.';
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

    private activeGraph(): ActiveAtlasGraph {
        const atlas = this.embeddingAtlas();
        const trace = this.queryTrace();
        const graphInventory = this.graphInventory();
        const graphKindFilter = this.graphKindFilter();
        const cached = this.activeGraphCache;
        if (
            cached &&
            cached.mode === this.atlasMode &&
            cached.entities === this.entities &&
            cached.edges === this.edges &&
            cached.atlas === atlas &&
            cached.trace === trace &&
            cached.graphInventory === graphInventory &&
            cached.graphKindFilter === graphKindFilter
        ) {
            return cached;
        }

        if (this.atlasMode === 'entities') {
            const nodes = this.entities.map((entity) => this.entityNodeWithSource(entity));
            this.activeGraphCache = {
                mode: this.atlasMode,
                entities: this.entities,
                edges: this.edges,
                atlas,
                trace,
                graphInventory,
                graphKindFilter,
                nodes,
                graphEdges: this.edges,
            };
            return this.activeGraphCache;
        }

        if (this.atlasMode === 'graph') {
            const allowed = graphKindFilter === 'all' ? null : new Set(
                graphInventory.nodes.filter((node) => normalizeGraphKind(node.kind) === graphKindFilter).map((node) => node.id),
            );
            const nodes = allowed ? graphInventory.nodes.filter((node) => allowed.has(node.id)) : graphInventory.nodes;
            const graphEdges = allowed
                ? graphInventory.edges.filter((edge) => allowed.has(edge.sourceId) && allowed.has(edge.targetId))
                : graphInventory.edges;
            this.activeGraphCache = {
                mode: this.atlasMode,
                entities: this.entities,
                edges: this.edges,
                atlas,
                trace,
                graphInventory,
                graphKindFilter,
                nodes,
                graphEdges,
            };
            return this.activeGraphCache;
        }

        const embeddingNodes = this.embeddingNodesWithEntityAnchors();
        const embeddingEdges = this.embeddingEdgesWithEntityAnchors();
        this.activeGraphCache = {
            mode: this.atlasMode,
            entities: this.entities,
            edges: this.edges,
            atlas,
            trace,
            graphInventory,
            graphKindFilter,
            nodes: trace ? [trace.queryNode, ...embeddingNodes] : embeddingNodes,
            graphEdges: trace ? [...trace.edges, ...embeddingEdges] : embeddingEdges,
        };
        return this.activeGraphCache;
    }

    private embeddingNodesWithEntityAnchors(): GalaxyRenderableNode[] {
        const atlas = this.embeddingAtlas();
        if (!this.entities.length || !atlas.nodes.length) return atlas.nodes;
        const anchors = this.entities.slice(0, 80).map((entity, index) => {
            const sourceSystem = entitySourceSystem(entity as RegisteredEntity);
            const matches = matchingEmbeddingNodes(entity, atlas.nodes).slice(0, 8);
            const point = matches.length
                ? averageAtlasPoint(matches)
                : fallbackEntityPoint(entity.id, index, this.entities.length);
            return {
                id: `embed:entity:${entity.id}`,
                label: entity.label,
                kind: entity.kind,
                aliases: entity.aliases,
                totalMentions: Math.max(4, entity.totalMentions || matches.length || 1),
                atlasX: point.x,
                atlasY: point.y,
                atlasZ: point.z,
                colorHsl: entity.colorHsl,
                metadata: {
                    ...entity.metadata,
                    sourceType: 'entity',
                    sourceSystem,
                    sourceColorHsl: entityColorStore.getRawSourceHsl(sourceSystem),
                    sourceEntityId: entity.id,
                    galaxyId: `embed:entity:${entity.id}`,
                    galaxyRole: 'primary',
                    preview: matches.length ? `Anchored by ${matches.length} nearby text vector${matches.length === 1 ? '' : 's'}.` : 'Registry entity anchor.',
                },
            } satisfies GalaxyRenderableNode;
        });
        return [...atlas.nodes, ...anchors];
    }

    private entityNodeWithSource(entity: GalaxyRenderableNode): GalaxyRenderableNode {
        const sourceSystem = entitySourceSystem(entity as RegisteredEntity);
        return {
            ...entity,
            metadata: {
                ...entity.metadata,
                sourceType: entity.metadata?.sourceType || 'registry_entity',
                sourceSystem,
                sourceColorHsl: entityColorStore.getRawSourceHsl(sourceSystem),
            },
        };
    }

    private embeddingEdgesWithEntityAnchors(): AtlasPreviewEdge[] {
        const atlas = this.embeddingAtlas();
        if (!this.entities.length || !atlas.nodes.length) return atlas.edges;
        const anchorEdges: AtlasPreviewEdge[] = [];
        for (const entity of this.entities.slice(0, 80)) {
            const matches = matchingEmbeddingNodes(entity, atlas.nodes).slice(0, 5);
            for (const [index, node] of matches.entries()) {
                anchorEdges.push({
                    id: `embed:entity-edge:${entity.id}:${node.id}`,
                    sourceId: `embed:entity:${entity.id}`,
                    targetId: node.id,
                    type: 'entity-embedding-anchor',
                    confidence: 1.4 - index * 0.12,
                });
            }
        }
        return [...atlas.edges, ...anchorEdges];
    }

    private async refreshGraphInventory(scope: ResolvedScope): Promise<void> {
        const token = ++this.graphLoadToken;
        try {
            const delta = await this.phoenixUiApi.knowledgeGraphDelta(this.toSearchScope(scope));
            if (token === this.graphLoadToken) {
                this.graphInventory.set(graphInventoryFromDelta(delta));
            }
        } catch (error) {
            console.warn('[GraphAtlasPreview] Failed to load graph inventory', error);
            if (token === this.graphLoadToken) this.graphInventory.set(EMPTY_GRAPH_INVENTORY);
        }
    }

    private toSearchScope(scope: ResolvedScope): SearchScope {
        if (scope.type === 'note' || scope.selectedNoteId) return { noteId: scope.selectedNoteId || scope.id };
        if (scope.narrativeId) return { narrativeId: scope.narrativeId };
        if (scope.type === 'folder' || scope.scopeFolderId !== 'vault:global') {
            return { folderId: scope.scopeFolderId, folderPath: scope.label };
        }
        return {};
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

function graphInventoryFromDelta(delta: PhoenixGraphDeltaBinaryResult): GraphInventory {
    const nodes: GalaxyRenderableNode[] = [];
    const idSet = new Set<string>();

    for (const chunk of delta.chunks || []) {
        const id = chunk.vertexId || `leaf:${chunk.chunkId}`;
        if (!id || idSet.has(id)) continue;
        idSet.add(id);
        nodes.push({
            id,
            label: `Leaf ${chunk.chapterId}:${chunk.start}-${chunk.end}`,
            kind: 'leaf',
            totalMentions: 1,
            ...stableAtlasPoint(id, nodes.length),
            colorHsl: graphKindHsl('leaf'),
            metadata: {
                sourceType: 'graph',
                graphKind: 'leaf',
                graphNodeId: id,
                chunkId: chunk.chunkId,
                documentId: chunk.documentId,
                noteId: chunk.noteId,
                graphSource: 'graph_delta',
            },
        });
    }

    for (const node of delta.nodes || []) {
        const id = node.nodeId;
        if (!id || idSet.has(id)) continue;
        idSet.add(id);
        const kind = normalizeGraphKind(node.kind || 'generic');
        nodes.push({
            id,
            label: node.label || id,
            kind,
            totalMentions: Math.max(1, Math.abs(Number(node.weight || 1))),
            ...stableAtlasPoint(id, nodes.length),
            colorHsl: graphKindHsl(kind),
            metadata: {
                sourceType: 'graph',
                graphKind: kind,
                graphNodeId: id,
                sourceEntityId: node.entityId,
                documentId: node.documentId,
                graphSource: 'graph_delta',
            },
        });
    }

    const edges: AtlasPreviewEdge[] = [];
    const edgeSeen = new Set<string>();
    for (const edge of delta.edges || []) {
        if (!idSet.has(edge.sourceId) || !idSet.has(edge.targetId)) continue;
        const id = `graph:${edge.sourceId}->${edge.targetId}:${edge.edgeType}`;
        if (edgeSeen.has(id)) continue;
        edgeSeen.add(id);
        edges.push({
            id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            type: edge.edgeType || 'graph-edge',
            confidence: Math.max(0.25, Math.min(1.8, Math.abs(Number(edge.weight || 1)) / 8)),
        });
    }

    return {
        nodes,
        edges,
        kindCounts: graphKindCounts(nodes),
        sourceLabel: 'backend graph delta',
    };
}

function graphKindCounts(nodes: GalaxyRenderableNode[]): Array<{ kind: string; count: number }> {
    const counts = new Map<string, number>();
    for (const node of nodes) {
        const kind = normalizeGraphKind(node.kind);
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function normalizeGraphKind(kind: string): string {
    return String(kind || 'generic').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function graphKindHsl(kind: string): string {
    switch (normalizeGraphKind(kind)) {
        case 'document': return '210 82% 58%';
        case 'chunk':
        case 'leaf': return '176 70% 46%';
        case 'entity': return '280 70% 60%';
        case 'mention': return '265 80% 66%';
        case 'alias': return '315 72% 58%';
        case 'event': return '25 90% 55%';
        case 'state': return '145 68% 48%';
        case 'memory': return '188 76% 52%';
        case 'timeanchor':
        case 'time-anchor': return '38 90% 56%';
        case 'candidate': return '260 28% 58%';
        default: return '220 10% 54%';
    }
}

function stableAtlasPoint(id: string, index: number): { atlasX: number; atlasY: number; atlasZ: number } {
    const angle = index * 2.399963229728653 + hashUnit(id) * 0.72;
    const y = 1 - ((index % 97) / 96) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = 0.88 + hashUnit(`${id}:radius`) * 0.16;
    return {
        atlasX: Math.cos(angle) * radial * radius,
        atlasY: y * 0.72,
        atlasZ: Math.sin(angle) * radial * radius,
    };
}

function matchingEmbeddingNodes(entity: GalaxyRenderableNode, nodes: GalaxyRenderableNode[]): GalaxyRenderableNode[] {
    const needles = [entity.label, ...(entity.aliases || [])]
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2);
    if (!needles.length) return [];
    return nodes.filter((node) => {
        const metadata = node.metadata || {};
        const haystack = `${node.label} ${String(metadata['preview'] || '')}`.toLowerCase();
        return needles.some((needle) => containsWordish(haystack, needle));
    });
}

function containsWordish(haystack: string, needle: string): boolean {
    const index = haystack.indexOf(needle);
    if (index < 0) return false;
    const before = index === 0 ? ' ' : haystack[index - 1];
    const after = index + needle.length >= haystack.length ? ' ' : haystack[index + needle.length];
    return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(value: string): boolean {
    return /[a-z0-9_]/i.test(value);
}

function averageAtlasPoint(nodes: GalaxyRenderableNode[]): { x: number; y: number; z: number } {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const node of nodes) {
        x += Number(node.atlasX || 0);
        y += Number(node.atlasY || 0);
        z += Number(node.atlasZ || 0);
    }
    const scale = 1 / Math.max(1, nodes.length);
    return { x: x * scale, y: y * scale, z: z * scale };
}

function fallbackEntityPoint(id: string, index: number, total: number): { x: number; y: number; z: number } {
    const angle = index * 2.399963229728653;
    const radius = 0.38 + (hashUnit(id) * 0.32);
    const y = total > 1 ? 0.7 - (index / (total - 1)) * 1.4 : 0;
    return {
        x: Math.cos(angle) * radius,
        y,
        z: Math.sin(angle) * radius,
    };
}

function hashUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}
