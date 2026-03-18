/**
 * LLM Entity Extractor Service
 * 
 * Extracts entities from notes using LLM via Go WASM.
 * 
 * Uses GoKittService for actual extraction (Go handles prompt+LLM+parsing).
 * LlmBatchService retained for configuration settings only.
 */

import { Injectable, inject, signal } from '@angular/core';
import * as ops from '../operations';
import { smartGraphRegistry } from '../registry';
import { LlmBatchService } from './llm-batch.service';
import { GoKittService } from '../../services/gokitt.service';
import { type EntityKind, isEntityKind } from '../types';

export interface ExtractedEntity {
    label: string;
    kind: EntityKind;
    aliases?: string[];
    confidence: number;
    sourceNoteId: string;
}

export interface ExtractionResult {
    entities: ExtractedEntity[];
    notesProcessed: number;
    errors: string[];
}

export interface CommitResult {
    created: number;
    updated: number;
    skipped: number;
}

@Injectable({
    providedIn: 'root'
})
export class LlmEntityExtractorService {
    // Config service for settings UI
    private llmBatch = inject(LlmBatchService);
    // Go WASM bridge for actual extraction
    private goKitt = inject(GoKittService);
    // Track whether Go batch was initialized
    private goBatchInitialized = false;

    // Extraction state
    isExtracting = signal(false);
    extractionProgress = signal({ current: 0, total: 0 });

    /**
     * Check if the batch LLM is configured
     */
    isConfigured(): boolean {
        return this.llmBatch.isConfigured();
    }

    /**
     * Get current provider/model info for display
     */
    getProviderInfo(): { provider: string; model: string } {
        return {
            provider: this.llmBatch.provider(),
            model: this.llmBatch.currentModel()
        };
    }

    /**
     * Ensure Go batch service is initialized with current config.
     */
    private async ensureGoBatchInit(): Promise<void> {
        if (this.goBatchInitialized) return;

        const cfg = this.llmBatch.getConfig();
        const result = await this.goKitt.batchInit({
            provider: cfg.provider,
            googleApiKey: cfg.googleApiKey,
            googleModel: cfg.googleModel,
            openRouterApiKey: cfg.openRouterApiKey,
            openRouterModel: cfg.openRouterModel,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            structuredOutput: cfg.structuredOutput,
            plugins: cfg.plugins
        });

        if (result.success) {
            this.goBatchInitialized = true;
            console.log('[LlmEntityExtractor] Go batch initialized:', result.provider, result.model);
        } else {
            console.error('[LlmEntityExtractor] Go batch init failed:', result.error);
            throw new Error(`Go batch init failed: ${result.error}`);
        }
    }

    /**
     * Extract entities from a single note's text via Go WASM.
     * Go handles prompt construction, LLM call, and JSON parsing.
     */
    async extractFromNote(noteId: string, text: string): Promise<ExtractedEntity[]> {
        if (!text.trim()) return [];

        try {
            await this.ensureGoBatchInit();

            // Go handles prompt + LLM call + parsing
            const entities = await this.goKitt.extractEntities(text);

            // Stamp sourceNoteId (Go doesn't know about note IDs)
            return (entities || []).map((e: any) => ({
                label: e.label || '',
                kind: isEntityKind(e.kind) ? e.kind : 'CHARACTER' as EntityKind,
                aliases: e.aliases,
                confidence: e.confidence ?? 0.8,
                sourceNoteId: noteId
            }));
        } catch (err) {
            console.error('[LlmEntityExtractor] Extraction failed for note:', noteId, err);
            return [];
        }
    }

    /**
     * Extract entities from ALL notes in a narrative folder
     */
    async extractFromNarrative(narrativeId: string): Promise<ExtractionResult> {
        const result: ExtractionResult = {
            entities: [],
            notesProcessed: 0,
            errors: []
        };

        this.isExtracting.set(true);

        try {
            // Get all notes in this narrative (folder and subfolders)
            const noteIds = await this.getNoteIdsInNarrative(narrativeId);
            this.extractionProgress.set({ current: 0, total: noteIds.length });

            const info = this.getProviderInfo();
            console.log(`[LlmEntityExtractor] Extracting from ${noteIds.length} notes using ${info.provider}/${info.model}`);

            const entityMap = new Map<string, ExtractedEntity>(); // Dedupe by normalized label

            for (let i = 0; i < noteIds.length; i++) {
                const noteId = noteIds[i];
                this.extractionProgress.set({ current: i + 1, total: noteIds.length });

                try {
                    const note = await ops.getNote(noteId);
                    if (!note?.content) continue;

                    const extracted = await this.extractFromNote(noteId, note.content);

                    // Merge into dedupe map
                    for (const entity of extracted) {
                        const key = entity.label.toLowerCase().trim();
                        if (!entityMap.has(key)) {
                            entityMap.set(key, entity);
                        } else {
                            // Merge aliases
                            const existing = entityMap.get(key)!;
                            if (entity.aliases) {
                                existing.aliases = [...new Set([...(existing.aliases || []), ...entity.aliases])];
                            }
                            // Keep higher confidence
                            if (entity.confidence > existing.confidence) {
                                existing.confidence = entity.confidence;
                            }
                        }
                    }

                    result.notesProcessed++;
                } catch (err) {
                    result.errors.push(`Note ${noteId}: ${err}`);
                }
            }

            result.entities = Array.from(entityMap.values());
        } finally {
            this.isExtracting.set(false);
            this.extractionProgress.set({ current: 0, total: 0 });
        }

        return result;
    }

    /**
     * Commit extracted entities to the registry
     * Auto-skips already registered entities
     */
    async commitToRegistry(entities: ExtractedEntity[]): Promise<CommitResult> {
        const result: CommitResult = {
            created: 0,
            updated: 0,
            skipped: 0
        };

        for (const entity of entities) {
            // Check if already exists
            const existing = smartGraphRegistry.findEntityByLabel(entity.label);

            if (existing) {
                result.skipped++;
                continue;
            }

            try {
                smartGraphRegistry.registerEntity(
                    entity.label,
                    entity.kind,
                    entity.sourceNoteId,
                    {
                        aliases: entity.aliases,
                        source: 'extraction'
                    }
                );
                result.created++;
            } catch (err) {
                console.error('[LlmEntityExtractor] Failed to register:', entity.label, err);
            }
        }

        console.log(`[LlmEntityExtractor] Committed: ${result.created} created, ${result.skipped} skipped`);
        return result;
    }

    /**
     * Get all note IDs within a narrative folder (recursively)
     */
    private async getNoteIdsInNarrative(narrativeId: string): Promise<string[]> {
        const noteIds: string[] = [];

        const folderIds = await this.getDescendantFolderIds(narrativeId);
        folderIds.push(narrativeId);

        for (const folderId of folderIds) {
            const notes = await ops.getNotesByFolder(folderId);
            noteIds.push(...notes.map(n => n.id));
        }

        return noteIds;
    }

    /**
     * Recursively get all descendant folder IDs
     */
    private async getDescendantFolderIds(parentId: string): Promise<string[]> {
        const result: string[] = [];
        const children = await ops.getFolderChildren(parentId);

        for (const child of children) {
            result.push(child.id);
            const descendants = await this.getDescendantFolderIds(child.id);
            result.push(...descendants);
        }

        return result;
    }
}

