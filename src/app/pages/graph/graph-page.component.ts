/**
 * Graph Page Component
 * 
 * Full-featured 3D force-directed graph visualization.
 * Renders between sidebars, same layout as Fantasy Calendar.
 */

import { Component, signal, inject, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideAngularModule, ArrowLeft, RefreshCw, Settings, Maximize2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-angular';
import { type ForceGraphData } from '../../services/graph-viz.service';
import { GraphPipelineService } from '../../services/graph-pipeline.service';

// ─────────────────────────────────────────────────────────────────────────────
// Graph Settings Interface
// ─────────────────────────────────────────────────────────────────────────────

interface GraphSettings {
    showArrows: boolean;
    showParticles: boolean;
    curvedLinks: boolean;
    bloomEffect: boolean;
    nodeLabels: boolean;
    linkLabels: boolean;
    autoOrbit: boolean;
    dagMode: string | null;
    highlightOnHover: boolean;
    nodeSizeByMentions: boolean;
    linkDistance: number;
    chargeStrength: number;
}

const DEFAULT_SETTINGS: GraphSettings = {
    showArrows: false,
    showParticles: false,
    curvedLinks: false,
    bloomEffect: false,
    nodeLabels: true,
    linkLabels: false,
    autoOrbit: false,
    dagMode: null,
    highlightOnHover: true,
    nodeSizeByMentions: true,
    linkDistance: 120,
    chargeStrength: -80,
};

@Component({
    selector: 'app-graph-page',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    template: `
        <div class="h-full flex flex-col bg-[#0a0a0f]">
            <!-- Top Toolbar -->
            <div class="flex items-center gap-4 px-4 py-2 border-b border-white/10 bg-[#12121a]">
                <button 
                    (click)="navigateToEditor()"
                    class="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
                    <lucide-icon [img]="ArrowLeft" size="16"></lucide-icon>
                    Back to Editor
                </button>
                
                <div class="flex-1 text-center">
                    <h1 class="text-lg font-semibold text-white/90">Knowledge Graph</h1>
                    <p class="text-xs text-slate-500">{{ stats().totalNodes }} nodes · {{ stats().totalLinks }} links</p>
                </div>
                
                <div class="flex items-center gap-2">
                    <button 
                        (click)="refreshGraph()"
                        class="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Refresh Graph">
                        <lucide-icon [img]="RefreshCw" size="16"></lucide-icon>
                    </button>
                    <button 
                        (click)="fitToCanvas()"
                        class="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Fit to View">
                        <lucide-icon [img]="Maximize2" size="16"></lucide-icon>
                    </button>
                    <button 
                        (click)="toggleSettings()"
                        class="p-2 rounded-md transition-colors"
                        [class.bg-cyan-500/20]="showSettings()"
                        [class.text-cyan-400]="showSettings()"
                        [class.text-slate-400]="!showSettings()"
                        [class.hover:text-white]="!showSettings()"
                        [class.hover:bg-white/10]="!showSettings()"
                        title="Settings">
                        <lucide-icon [img]="Settings" size="16"></lucide-icon>
                    </button>
                </div>
            </div>

            <!-- Main Content -->
            <div class="flex-1 flex overflow-hidden relative">
                <!-- 3D Graph Canvas -->
                <div #graphContainer class="flex-1 relative">
                    <!-- Loading State -->
                    <div *ngIf="loading()" class="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]">
                        <div class="text-center">
                            <div class="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
                            <p class="text-slate-400">Loading graph...</p>
                        </div>
                    </div>
                    
                    <!-- Empty State -->
                    <div *ngIf="!loading() && stats().totalNodes === 0" class="absolute inset-0 flex items-center justify-center">
                        <div class="text-center max-w-md px-8">
                            <div class="w-16 h-16 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto mb-4">
                                <svg class="w-8 h-8 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                                </svg>
                            </div>
                            <h3 class="text-lg font-medium text-white mb-2">No Entities Found</h3>
                            <p class="text-slate-400 text-sm">Write some notes with [[entities]] to see them visualized here.</p>
                        </div>
                    </div>
                </div>

                <!-- Settings Panel -->
                <div *ngIf="showSettings()" 
                     class="w-72 border-l border-white/10 bg-[#12121a] overflow-y-auto">
                    <div class="p-4 space-y-6">
                        <!-- Visual Effects -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Visual Effects</h3>
                            <div class="space-y-3">
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Directional Arrows</span>
                                    <input type="checkbox" [(ngModel)]="settings.showArrows" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Moving Particles</span>
                                    <input type="checkbox" [(ngModel)]="settings.showParticles" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Curved Links</span>
                                    <input type="checkbox" [(ngModel)]="settings.curvedLinks" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Bloom Effect</span>
                                    <input type="checkbox" [(ngModel)]="settings.bloomEffect" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                            </div>
                        </section>

                        <!-- Labels -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Labels</h3>
                            <div class="space-y-3">
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Node Labels</span>
                                    <input type="checkbox" [(ngModel)]="settings.nodeLabels" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Link Labels</span>
                                    <input type="checkbox" [(ngModel)]="settings.linkLabels" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                            </div>
                        </section>

                        <!-- Camera -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Camera</h3>
                            <div class="space-y-3">
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Auto-Orbit</span>
                                    <input type="checkbox" [(ngModel)]="settings.autoOrbit" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Highlight on Hover</span>
                                    <input type="checkbox" [(ngModel)]="settings.highlightOnHover" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                            </div>
                        </section>

                        <!-- Layout -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Layout</h3>
                            <div class="space-y-3">
                                <label class="flex items-center justify-between cursor-pointer group">
                                    <span class="text-sm text-slate-300 group-hover:text-white">Size by Mentions</span>
                                    <input type="checkbox" [(ngModel)]="settings.nodeSizeByMentions" (change)="updateGraph()"
                                           class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-cyan-500 focus:ring-cyan-500/50">
                                </label>
                                <div>
                                    <label class="text-sm text-slate-300 mb-1 block">DAG Mode</label>
                                    <select [(ngModel)]="settings.dagMode" (change)="updateGraph()"
                                            class="w-full px-3 py-1.5 text-sm rounded-md bg-slate-800 border border-slate-700 text-slate-300 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50">
                                        <option [ngValue]="null">None (Free)</option>
                                        <option value="td">Top-Down</option>
                                        <option value="bu">Bottom-Up</option>
                                        <option value="lr">Left-Right</option>
                                        <option value="rl">Right-Left</option>
                                        <option value="radialout">Radial Out</option>
                                        <option value="radialin">Radial In</option>
                                    </select>
                                </div>
                            </div>
                        </section>

                        <!-- Physics -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Physics</h3>
                            <div class="space-y-4">
                                <div>
                                    <div class="flex justify-between mb-1">
                                        <label class="text-sm text-slate-300">Link Distance</label>
                                        <span class="text-xs text-slate-500">{{ settings.linkDistance }}</span>
                                    </div>
                                    <input type="range" [(ngModel)]="settings.linkDistance" (change)="updateGraph()"
                                           min="30" max="300" step="10"
                                           class="w-full h-1.5 rounded-full bg-slate-700 appearance-none cursor-pointer accent-cyan-500">
                                </div>
                                <div>
                                    <div class="flex justify-between mb-1">
                                        <label class="text-sm text-slate-300">Charge Strength</label>
                                        <span class="text-xs text-slate-500">{{ settings.chargeStrength }}</span>
                                    </div>
                                    <input type="range" [(ngModel)]="settings.chargeStrength" (change)="updateGraph()"
                                           min="-200" max="-10" step="10"
                                           class="w-full h-1.5 rounded-full bg-slate-700 appearance-none cursor-pointer accent-cyan-500">
                                </div>
                                <button 
                                    (click)="reheatSimulation()"
                                    class="w-full px-3 py-2 text-sm rounded-md bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors flex items-center justify-center gap-2">
                                    <lucide-icon [img]="RotateCcw" size="14"></lucide-icon>
                                    Reheat Simulation
                                </button>
                            </div>
                        </section>

                        <!-- Stats -->
                        <section>
                            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Statistics</h3>
                            <div class="space-y-2 text-sm">
                                <div class="flex justify-between">
                                    <span class="text-slate-400">Nodes</span>
                                    <span class="text-white">{{ stats().totalNodes }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-slate-400">Links</span>
                                    <span class="text-white">{{ stats().totalLinks }}</span>
                                </div>
                                <div *ngFor="let kind of kindStats()" class="flex justify-between">
                                    <span class="text-slate-400">{{ kind.name }}</span>
                                    <span class="text-white">{{ kind.count }}</span>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }
        
        /* Custom checkbox styling */
        input[type="checkbox"] {
            cursor: pointer;
        }
        
        /* Range slider thumb */
        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #22d3ee;
            cursor: pointer;
        }
    `]
})
export class GraphPageComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild('graphContainer', { static: true }) graphContainer!: ElementRef<HTMLDivElement>;

    private router = inject(Router);
    private graphPipeline = inject(GraphPipelineService);

    // Icons
    readonly ArrowLeft = ArrowLeft;
    readonly RefreshCw = RefreshCw;
    readonly Settings = Settings;
    readonly Maximize2 = Maximize2;
    readonly ZoomIn = ZoomIn;
    readonly ZoomOut = ZoomOut;
    readonly RotateCcw = RotateCcw;

    // State
    readonly loading = signal(true);
    readonly showSettings = signal(true);
    readonly stats = signal({ totalNodes: 0, totalLinks: 0, kindCounts: {} as Record<string, number>, typeCounts: {} as Record<string, number> });

    // Settings
    settings: GraphSettings = { ...DEFAULT_SETTINGS };

    // 3d-force-graph instance
    private graph: any = null;
    private graphData: ForceGraphData = { nodes: [], links: [] };
    private resizeObserver: ResizeObserver | null = null;

    // Highlight state
    private highlightNodes = new Set<string>();
    private highlightLinks = new Set<any>();
    private hoverNode: any = null;

    constructor() {
        console.log('[GraphPage] Component created');
    }

    ngOnInit(): void {
        console.log('[GraphPage] Initializing...');
    }

    async ngAfterViewInit(): Promise<void> {
        await this.initGraph();
        this.setupResizeObserver();
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        if (this.graph) {
            this.graph._destructor?.();
        }
    }

    private async initGraph(): Promise<void> {
        try {
            // Dynamically import 3d-force-graph to avoid SSR issues
            const ForceGraph3DModule = await import('3d-force-graph');
            const ForceGraph3D = ForceGraph3DModule.default;

            await this.loadGraphData(true);
            console.log('[GraphPage] Graph data loaded:', this.graphData.stats);

            // Create the graph instance - ForceGraph3D is a factory function
            this.graph = new ForceGraph3D(this.graphContainer.nativeElement)
                .backgroundColor('#0a0a0f')
                .graphData(this.graphData)
                .nodeId('id')
                .nodeLabel((node: any) => this.settings.nodeLabels ? node.name : '')
                .nodeVal((node: any) => this.settings.nodeSizeByMentions ? (node.val || 1) : 1)
                .nodeColor((node: any) => this.getNodeColor(node))
                .nodeOpacity(0.9)
                .linkSource('source')
                .linkTarget('target')
                .linkLabel((link: any) => this.settings.linkLabels ? (link.type || '') : '')
                .linkColor((link: any) => this.getLinkColor(link))
                .linkOpacity(0.6)
                .linkWidth(1)
                .linkDirectionalArrowLength((link: any) => this.settings.showArrows ? 4 : 0)
                .linkDirectionalArrowRelPos(1)
                .linkDirectionalParticles((link: any) => this.settings.showParticles ? 2 : 0)
                .linkDirectionalParticleWidth(2)
                .linkDirectionalParticleSpeed(0.005)
                .linkCurvature((link: any) => this.settings.curvedLinks ? 0.25 : 0)
                .d3AlphaDecay(0.02)
                .d3VelocityDecay(0.3)
                .onNodeClick((node: any) => this.onNodeClick(node))
                .onNodeHover((node: any) => this.onNodeHover(node))
                .onLinkHover((link: any) => this.onLinkHover(link));

            // Apply physics settings
            this.graph.d3Force('link')?.distance(this.settings.linkDistance);
            this.graph.d3Force('charge')?.strength(this.settings.chargeStrength);

            // Apply DAG mode if set
            if (this.settings.dagMode) {
                this.graph.dagMode(this.settings.dagMode);
            }

            // Setup camera auto-orbit if enabled
            if (this.settings.autoOrbit) {
                this.startAutoOrbit();
            }

            this.loading.set(false);

            // Fit to view after initial render
            setTimeout(() => this.fitToCanvas(), 500);

        } catch (error) {
            console.error('[GraphPage] Failed to initialize graph:', error);
            this.loading.set(false);
        }
    }

    private async loadGraphData(sync = false): Promise<void> {
        const result = await this.graphPipeline.loadPersistedGraph({ sync });
        this.graphData = result.graphData;
        this.stats.set(this.graphData.stats || { totalNodes: 0, totalLinks: 0, kindCounts: {}, typeCounts: {} });
    }

    private getNodeColor(node: any): string {
        if (this.settings.highlightOnHover && this.highlightNodes.size > 0) {
            return this.highlightNodes.has(node.id) ? node.color : '#333333';
        }
        return node.color || '#64748b';
    }

    private getLinkColor(link: any): string {
        if (this.settings.highlightOnHover && this.highlightLinks.size > 0) {
            return this.highlightLinks.has(link) ? '#22d3ee' : '#1a1a2e';
        }
        return link.color || '#475569';
    }

    private onNodeClick(node: any): void {
        if (node) {
            console.log('[GraphPage] Node clicked:', node.name, node.kind);
            // Could navigate to entity factsheet or note
        }
    }

    private onNodeHover(node: any): void {
        if (!this.settings.highlightOnHover) return;

        this.highlightNodes.clear();
        this.highlightLinks.clear();

        if (node) {
            this.hoverNode = node;
            this.highlightNodes.add(node.id);

            // Highlight connected nodes and links
            this.graphData.links.forEach((link: any) => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;

                if (sourceId === node.id || targetId === node.id) {
                    this.highlightLinks.add(link);
                    this.highlightNodes.add(sourceId);
                    this.highlightNodes.add(targetId);
                }
            });
        } else {
            this.hoverNode = null;
        }

        this.graph?.nodeColor(this.graph.nodeColor());
        this.graph?.linkColor(this.graph.linkColor());
    }

    private onLinkHover(link: any): void {
        // Could implement link highlighting here
    }

    private startAutoOrbit(): void {
        if (!this.graph) return;

        let angle = 0;
        const distance = 400;

        const orbit = () => {
            if (!this.settings.autoOrbit || !this.graph) return;

            angle += 0.002;
            this.graph.cameraPosition({
                x: distance * Math.sin(angle),
                z: distance * Math.cos(angle)
            });

            requestAnimationFrame(orbit);
        };

        orbit();
    }

    private setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => {
            if (this.graph) {
                const { width, height } = this.graphContainer.nativeElement.getBoundingClientRect();
                this.graph.width(width).height(height);
            }
        });
        this.resizeObserver.observe(this.graphContainer.nativeElement);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public Methods
    // ─────────────────────────────────────────────────────────────────────────

    navigateToEditor(): void {
        this.router.navigate(['/']);
    }

    toggleSettings(): void {
        this.showSettings.update(v => !v);
    }

    async refreshGraph(): Promise<void> {
        this.loading.set(true);
        try {
            await this.loadGraphData(true);

            if (this.graph) {
                this.graph.graphData(this.graphData);
            }
        } catch (error) {
            console.error('[GraphPage] Refresh failed:', error);
        } finally {
            this.loading.set(false);
            setTimeout(() => this.fitToCanvas(), 300);
        }
    }

    updateGraph(): void {
        if (!this.graph) return;

        this.graph
            .nodeLabel((node: any) => this.settings.nodeLabels ? node.name : '')
            .nodeVal((node: any) => this.settings.nodeSizeByMentions ? (node.val || 1) : 1)
            .linkLabel((link: any) => this.settings.linkLabels ? (link.type || '') : '')
            .linkDirectionalArrowLength((link: any) => this.settings.showArrows ? 4 : 0)
            .linkDirectionalParticles((link: any) => this.settings.showParticles ? 2 : 0)
            .linkCurvature((link: any) => this.settings.curvedLinks ? 0.25 : 0);

        // Update physics
        this.graph.d3Force('link')?.distance(this.settings.linkDistance);
        this.graph.d3Force('charge')?.strength(this.settings.chargeStrength);

        // Update DAG mode
        this.graph.dagMode(this.settings.dagMode);

        // Handle bloom effect (requires postprocessing)
        // Note: Full bloom implementation would require Three.js postprocessing setup

        // Handle auto-orbit
        if (this.settings.autoOrbit) {
            this.startAutoOrbit();
        }

        // Trigger re-render
        this.graph.nodeColor(this.graph.nodeColor());
        this.graph.linkColor(this.graph.linkColor());
    }

    fitToCanvas(): void {
        if (this.graph && this.graphData.nodes.length > 0) {
            this.graph.zoomToFit(400, 50);
        }
    }

    reheatSimulation(): void {
        if (this.graph) {
            this.graph.d3ReheatSimulation();
        }
    }

    kindStats(): { name: string; count: number }[] {
        const kindCounts = this.stats().kindCounts || {};
        return Object.entries(kindCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }
}
