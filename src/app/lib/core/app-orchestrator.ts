// src/app/lib/core/app-orchestrator.ts
// Application Boot Orchestrator
// Coordinates initialization order to prevent race conditions

import { Injectable, signal, computed } from '@angular/core';
import { Subject, firstValueFrom, filter, timeout, race, timer } from 'rxjs';

/**
 * Boot phases in strict order
 */
export type BootPhase =
    | 'shell'         // Phase 0: UI shell visible, spinner shown
    | 'registry'      // Phase 1: SmartGraphRegistry hydrated from Dexie cache
    | 'wasm_load'     // Phase 2: GoKitt WASM module loaded (not yet hydrated)
    | 'wasm_hydrate'  // Phase 3: GoKitt initialized with entities from registry
    | 'ready'         // Phase 4: App interactive — note can open, editor usable
    | 'background';   // Phase 5: CozoDB + DocStore finished (non-blocking)

interface PhaseInfo {
    name: BootPhase;
    started: number;       // Timestamp
    completed: number;     // Timestamp (0 = not complete)
    duration?: number;     // ms
}

/**
 * AppOrchestrator - Singleton that coordinates boot sequence
 * 
 * Usage:
 *   await orchestrator.waitFor('registry');  // Block until phase complete
 *   orchestrator.completePhase('registry'); // Signal phase done
 */
@Injectable({
    providedIn: 'root'
})
export class AppOrchestrator {
    // Current phase
    private readonly _currentPhase = signal<BootPhase>('shell');
    readonly currentPhase = this._currentPhase.asReadonly();

    // Phase completion signals
    private readonly phaseComplete$ = new Subject<BootPhase>();

    // Timing data for diagnostics
    private phases: Map<BootPhase, PhaseInfo> = new Map();
    private bootStart = Date.now();
    private readyLogged = false; // Prevent duplicate ready logs

    // Derived state
    readonly isReady = computed(() => this._currentPhase() === 'ready');
    readonly isWasmReady = computed(() => {
        const phase = this._currentPhase();
        return phase === 'wasm_hydrate' || phase === 'ready';
    });
    readonly isRegistryReady = computed(() => {
        const phase = this._currentPhase();
        return phase === 'registry' || phase === 'wasm_load' ||
            phase === 'wasm_hydrate' || phase === 'ready';
    });

    // Phase order for validation
    private readonly phaseOrder: BootPhase[] = [
        'shell', 'registry', 'wasm_load', 'wasm_hydrate', 'ready', 'background'
    ];

    constructor() {
        this.startPhase('shell');
        console.log('[Orchestrator] Boot sequence started');
    }

    /**
     * Start a phase (for timing)
     */
    private startPhase(phase: BootPhase): void {
        if (!this.phases.has(phase)) {
            this.phases.set(phase, {
                name: phase,
                started: Date.now(),
                completed: 0
            });
        }
    }

    /**
     * Complete a phase and advance to the next
     */
    completePhase(phase: BootPhase): void {
        const info = this.phases.get(phase);
        if (info && info.completed === 0) {
            info.completed = Date.now();
            info.duration = info.completed - info.started;
            console.log(`[Orchestrator] ✓ Phase '${phase}' complete (${info.duration}ms)`);
        }

        // Advance current phase
        const currentIndex = this.phaseOrder.indexOf(this._currentPhase());
        const completedIndex = this.phaseOrder.indexOf(phase);

        if (completedIndex >= currentIndex) {
            // Find the next incomplete phase or stay at ready
            const nextIndex = Math.min(completedIndex + 1, this.phaseOrder.length - 1);
            const nextPhase = this.phaseOrder[nextIndex];
            this._currentPhase.set(nextPhase);
            this.startPhase(nextPhase);
        }

        this.phaseComplete$.next(phase);

        // Log once when fully ready (prevent duplicate)
        if (phase === 'ready' && !this.readyLogged) {
            this.readyLogged = true;
            const totalTime = Date.now() - this.bootStart;
            console.log(`[Orchestrator] 🚀 App interactive in ${totalTime}ms`);
            this.logTimings();
        }
        if (phase === 'background') {
            const totalTime = Date.now() - this.bootStart;
            console.log(`[Orchestrator] ✅ All background tasks done in ${totalTime}ms`);
        }
    }

    /**
     * Wait for a specific phase to complete
     * Returns immediately if already past that phase
     */
    async waitFor(phase: BootPhase): Promise<void> {
        const targetIndex = this.phaseOrder.indexOf(phase);
        const currentIndex = this.phaseOrder.indexOf(this._currentPhase());

        // Already past this phase
        if (currentIndex > targetIndex) {
            return;
        }

        // Check if phase already completed
        const info = this.phases.get(phase);
        if (info && info.completed > 0) {
            return;
        }

        // Wait for phase completion
        await firstValueFrom(
            race(
                this.phaseComplete$.pipe(
                    filter(p => this.phaseOrder.indexOf(p) >= targetIndex)
                ),
                // Timeout after 30s to prevent infinite hang
                timer(30000).pipe(
                    filter(() => {
                        console.error(`[Orchestrator] ⚠️ Timeout waiting for phase '${phase}'`);
                        return true;
                    })
                )
            )
        );
    }

    /**
     * Check if a phase is complete
     */
    isPhaseComplete(phase: BootPhase): boolean {
        const info = this.phases.get(phase);
        return info?.completed !== undefined && info.completed > 0;
    }

    /**
     * Get current phase index for comparisons
     */
    getPhaseIndex(phase: BootPhase): number {
        return this.phaseOrder.indexOf(phase);
    }

    /**
     * Log timing summary
     */
    private logTimings(): void {
        console.group('[Orchestrator] Boot Timings');
        for (const phase of this.phaseOrder) {
            const info = this.phases.get(phase);
            if (info && info.duration) {
                console.log(`  ${phase}: ${info.duration}ms`);
            }
        }
        console.groupEnd();
    }

    /**
     * Reset for hot reload (dev only)
     */
    reset(): void {
        this._currentPhase.set('shell');
        this.phases.clear();
        this.bootStart = Date.now();
        this.readyLogged = false;
        this.startPhase('shell');
    }
}

// Singleton export for non-DI contexts (e.g., pretty-text-api.ts)
let _orchestratorInstance: AppOrchestrator | null = null;

export function getAppOrchestrator(): AppOrchestrator {
    if (!_orchestratorInstance) {
        throw new Error('[Orchestrator] Not yet initialized. Inject via DI.');
    }
    return _orchestratorInstance;
}

export function setAppOrchestrator(instance: AppOrchestrator): void {
    _orchestratorInstance = instance;
}
