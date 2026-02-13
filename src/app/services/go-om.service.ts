import { Injectable, inject, signal, computed } from '@angular/core';
import { GoKittService } from './gokitt.service';

/**
 * OMRecord holds the current observational memory state for a thread.
 * Mirrors Go struct from internal/store/models.go
 */
export interface OMRecord {
    threadId: string;
    observations: string;
    currentTask: string;
    lastObservedAt: number;
    obsTokenCount: number;
    generationNum: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * ProcessResult represents the result of a Process call.
 */
export interface OMProcessResult {
    observed: boolean;
    reflected: boolean;
}

/**
 * OMConfig for settings UI
 */
export interface OMConfig {
    enabled: boolean;
    observeThreshold: number;
    reflectThreshold: number;
}

/**
 * GoOMService - Angular wrapper for Observational Memory WASM functions.
 * 
 * The OM pipeline implements a three-agent architecture:
 * - Observer: Extracts observations from conversation messages
 * - Reflector: Compresses observations when they exceed threshold
 * - Actor: Injects observations into LLM context
 * 
 * @see plans/observational-memory-implementation.md
 */
@Injectable({ providedIn: 'root' })
export class GoOMService {
    private goKitt = inject(GoKittService);

    // Reactive state
    readonly config = signal<OMConfig>({
        enabled: true,
        observeThreshold: 1000,
        reflectThreshold: 4000,
    });

    readonly currentRecord = signal<OMRecord | null>(null);
    readonly isProcessing = signal(false);

    // Computed
    readonly hasObservations = computed(() => {
        const record = this.currentRecord();
        return record !== null && record.observations.length > 0;
    });

    readonly tokenCount = computed(() => {
        const record = this.currentRecord();
        return record?.obsTokenCount ?? 0;
    });

    /**
     * Update OM configuration (typically from settings UI)
     * Also syncs to Go WASM runtime.
     */
    async updateConfig(config: Partial<OMConfig>): Promise<void> {
        this.config.update(c => ({ ...c, ...config }));

        // Sync to Go WASM
        const { enabled, observeThreshold, reflectThreshold } = this.config();
        try {
            await this.goKitt.omSetConfig(enabled, observeThreshold, reflectThreshold);
            console.log('[GoOMService] Config synced to Go WASM:', { enabled, observeThreshold, reflectThreshold });
        } catch (err) {
            console.error('[GoOMService] Failed to sync config to Go WASM:', err);
        }
    }

    /**
     * Process a thread through the OM pipeline.
     * Called automatically after adding messages, or manually via this method.
     * Returns true if observation or reflection occurred.
     */
    async process(threadId: string): Promise<OMProcessResult> {
        this.isProcessing.set(true);
        try {
            const result = await this.goKitt.omProcess(threadId);

            // Refresh current record if observation occurred
            if (result.observed) {
                await this.loadRecord(threadId);
            }

            return result;
        } finally {
            this.isProcessing.set(false);
        }
    }

    /**
     * Get the OM record for a thread.
     * Returns null if no record exists.
     */
    async getRecord(threadId: string): Promise<OMRecord | null> {
        return this.goKitt.omGetRecord(threadId) as Promise<OMRecord | null>;
    }

    /**
     * Load and cache the OM record for a thread.
     */
    async loadRecord(threadId: string): Promise<void> {
        const record = await this.getRecord(threadId);
        this.currentRecord.set(record);
    }

    /**
     * Manually trigger observation for a thread.
     * Bypasses threshold check.
     */
    async observe(threadId: string): Promise<void> {
        this.isProcessing.set(true);
        try {
            await this.goKitt.omObserve(threadId);
            await this.loadRecord(threadId);
        } finally {
            this.isProcessing.set(false);
        }
    }

    /**
     * Manually trigger reflection for a thread.
     * Bypasses threshold check.
     */
    async reflect(threadId: string): Promise<void> {
        this.isProcessing.set(true);
        try {
            await this.goKitt.omReflect(threadId);
            await this.loadRecord(threadId);
        } finally {
            this.isProcessing.set(false);
        }
    }

    /**
     * Clear OM state for a thread.
     */
    async clear(threadId: string): Promise<void> {
        await this.goKitt.omClear(threadId);
        this.currentRecord.set(null);
    }

    /**
     * Get formatted observations for system prompt injection.
     * Returns empty string if no observations or OM disabled.
     */
    async getContext(threadId: string): Promise<string> {
        if (!this.config().enabled) {
            return '';
        }

        const record = await this.getRecord(threadId);
        if (!record || !record.observations) {
            return '';
        }

        let context = '<observations>\n';
        context += record.observations;
        if (record.currentTask) {
            context += `\n\nCurrent task: ${record.currentTask}`;
        }
        context += '\n</observations>';

        return context;
    }

    /**
     * Clear the cached current record.
     * Call when switching threads.
     */
    clearCache(): void {
        this.currentRecord.set(null);
    }
}
