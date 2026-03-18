/**
 * LLM Relationship Extractor Service
 * 
 * Extracts relationships between entities from notes using LLM via Go WASM.
 * Works alongside LlmEntityExtractorService to build the knowledge graph.
 * 
 * Go handles prompt construction, LLM call, and JSON parsing.
 * LlmBatchService retained for configuration settings only.
 * CST validation via GoKitt's validateRelations.
 */

import { Injectable, inject, signal } from '@angular/core';
import * as ops from '../operations';
import { smartGraphRegistry } from '../registry';
import { LlmBatchService } from './llm-batch.service';
import { type EntityKind, isEntityKind } from '../types';
import { GoKittService } from '../../services/gokitt.service';

// ============================================================================
// Types
// ============================================================================

/**
 * A relationship extracted by the LLM
 * Maps to GoKitt's QuadPlus structure for CST validation
 */
export interface ExtractedRelation {
    /** Subject entity label */
    subject: string;
    /** Subject entity kind (if known) */
    subjectKind?: EntityKind;
    /** Object/target entity label */
    object: string;
    /** Object entity kind (if known) */
    objectKind?: EntityKind;
    /** The verb phrase that implies the relationship */
    verb: string;
    /** Canonical relationship type (LEADS, ALLIED_WITH, CAPTIVE_OF, etc.) */
    relationType: string;
    /** Manner modifier (e.g., "with violence", "secretly") */
    manner?: string;
    /** Location modifier (e.g., "at Marineford", "in the New World") */
    location?: string;
    /** Time modifier (e.g., "during the war", "after the timeskip") */
    time?: string;
    /** Recipient for communication verbs (e.g., "told X to Y") */
    recipient?: string;
    /** LLM confidence in this extraction */
    confidence: number;
    /** The source sentence for CST validation */
    sourceSentence: string;
    /** Source note ID */
    sourceNoteId: string;
}

export interface RelationExtractionResult {
    relations: ExtractedRelation[];
    notesProcessed: number;
    errors: string[];
}

export interface RelationCommitResult {
    created: number;
    updated: number;
    skipped: number;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({
    providedIn: 'root'
})
export class LlmRelationExtractorService {
    private llmBatch = inject(LlmBatchService);
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
            console.log('[LlmRelationExtractor] Go batch initialized:', result.provider, result.model);
        } else {
            console.error('[LlmRelationExtractor] Go batch init failed:', result.error);
            throw new Error(`Go batch init failed: ${result.error}`);
        }
    }

    /**
     * Phase 2: Validate extracted relations against CST
     * Filters out hallucinations and adjusts confidence based on grounding
     */
    async validateWithCST(noteId: string, relations: ExtractedRelation[]): Promise<ExtractedRelation[]> {
        if (!this.goKitt.isReady) {
            console.warn('[LlmRelationExtractor] GoKitt not ready, skipping CST validation');
            return relations;
        }

        // Convert to format expected by Go validator
        const llmRelations = relations.map(r => ({
            subject: r.subject,
            object: r.object,
            verb: r.verb,
            relationType: r.relationType,
            confidence: r.confidence,
            sourceSentence: r.sourceSentence
        }));

        try {
            const result = await this.goKitt.validateRelations(noteId, llmRelations);

            console.log(`[LlmRelationExtractor] CST Validation: ${result.validCount}/${result.totalInput} valid`);

            // Filter to only valid relations and update confidence
            const validated: ExtractedRelation[] = [];
            for (const vr of result.relations) {
                if (vr.isValid) {
                    // Find original relation and update confidence
                    const original = relations.find(r =>
                        r.subject.toLowerCase() === vr.subject.toLowerCase() &&
                        r.object.toLowerCase() === vr.object.toLowerCase() &&
                        r.relationType === vr.relationType
                    );
                    if (original) {
                        validated.push({
                            ...original,
                            confidence: vr.confidence // Use CST-adjusted confidence
                        });
                    }
                }
            }

            return validated;
        } catch (e) {
            console.error('[LlmRelationExtractor] CST validation failed:', e);
            return relations; // Fall back to unvalidated
        }
    }

    /**
     * Extract relationships from a single note's text via Go WASM.
     * Go handles prompt construction, LLM call, and JSON parsing.
     * @param noteId The note ID for provenance
     * @param text The note content
     * @param knownEntities Optional list of known entity labels to prime extraction
     */
    async extractFromNote(
        noteId: string,
        text: string,
        knownEntities: string[] = []
    ): Promise<ExtractedRelation[]> {
        if (!text.trim()) return [];

        try {
            await this.ensureGoBatchInit();

            // Go handles prompt + LLM call + parsing
            const relations = await this.goKitt.extractRelations(text, knownEntities);

            // Stamp sourceNoteId (Go doesn't know about note IDs)
            return (relations || []).map((r: any) => ({
                subject: r.subject || '',
                subjectKind: r.subjectKind ? (isEntityKind(r.subjectKind) ? r.subjectKind : undefined) : undefined,
                object: r.object || '',
                objectKind: r.objectKind ? (isEntityKind(r.objectKind) ? r.objectKind : undefined) : undefined,
                verb: r.verb || '',
                relationType: r.relationType || 'KNOWS',
                manner: r.manner,
                location: r.location,
                time: r.time,
                recipient: r.recipient,
                confidence: r.confidence ?? 0.7,
                sourceSentence: r.sourceSentence || '',
                sourceNoteId: noteId
            }));
        } catch (err) {
            console.error('[LlmRelationExtractor] Extraction failed for note:', noteId, err);
            return [];
        }
    }

    /**
     * Extract relationships from ALL notes in a narrative folder
     */
    async extractFromNarrative(narrativeId: string): Promise<RelationExtractionResult> {
        const result: RelationExtractionResult = {
            relations: [],
            notesProcessed: 0,
            errors: []
        };

        this.isExtracting.set(true);

        try {
            // Get all notes in this narrative
            const noteIds = await this.getNoteIdsInNarrative(narrativeId);
            this.extractionProgress.set({ current: 0, total: noteIds.length });

            // Get known entities to prime extraction (use all entities for better results)
            const knownEntities = smartGraphRegistry.getAllEntities()
                .map(e => e.label);

            const info = this.getProviderInfo();
            console.log(`[LlmRelationExtractor] Extracting from ${noteIds.length} notes using ${info.provider}/${info.model}`);
            console.log(`[LlmRelationExtractor] Priming with ${knownEntities.length} known entities`);

            // Dedupe relations by (subject, object, relationType)
            const relationMap = new Map<string, ExtractedRelation>();

            for (let i = 0; i < noteIds.length; i++) {
                const noteId = noteIds[i];
                this.extractionProgress.set({ current: i + 1, total: noteIds.length });

                try {
                    const note = await ops.getNote(noteId);
                    if (!note?.content) continue;

                    const extracted = await this.extractFromNote(noteId, note.content, knownEntities);

                    // Merge into dedupe map
                    for (const rel of extracted) {
                        const key = `${rel.subject.toLowerCase()}|${rel.relationType}|${rel.object.toLowerCase()}`;

                        if (!relationMap.has(key)) {
                            relationMap.set(key, rel);
                        } else {
                            // Keep higher confidence version
                            const existing = relationMap.get(key)!;
                            if (rel.confidence > existing.confidence) {
                                relationMap.set(key, rel);
                            }
                        }
                    }

                    result.notesProcessed++;
                } catch (err) {
                    result.errors.push(`Note ${noteId}: ${err}`);
                }
            }

            result.relations = Array.from(relationMap.values());
            console.log(`[LlmRelationExtractor] Extracted ${result.relations.length} unique relations`);
        } finally {
            this.isExtracting.set(false);
            this.extractionProgress.set({ current: 0, total: 0 });
        }

        return result;
    }

    /**
     * Commit extracted relations to the graph registry
     */
    async commitToRegistry(relations: ExtractedRelation[]): Promise<RelationCommitResult> {
        const result: RelationCommitResult = {
            created: 0,
            updated: 0,
            skipped: 0
        };

        for (const rel of relations) {
            try {
                // Find or create subject entity
                let subjectEntity = smartGraphRegistry.findEntityByLabel(rel.subject);
                if (!subjectEntity) {
                    // Auto-register unknown subjects as CHARACTER (most common)
                    const subjectKind = rel.subjectKind || 'CHARACTER';
                    const regResult = smartGraphRegistry.registerEntity(
                        rel.subject,
                        subjectKind,
                        rel.sourceNoteId,
                        { source: 'extraction' }
                    );
                    subjectEntity = regResult.entity;
                }

                // Find or create object entity
                let objectEntity = smartGraphRegistry.findEntityByLabel(rel.object);
                if (!objectEntity) {
                    const objectKind = rel.objectKind || 'CHARACTER';
                    const regResult = smartGraphRegistry.registerEntity(
                        rel.object,
                        objectKind,
                        rel.sourceNoteId,
                        { source: 'extraction' }
                    );
                    objectEntity = regResult.entity;
                }

                // Check if relationship already exists
                const existingEdge = smartGraphRegistry.findEdge(
                    subjectEntity.id,
                    objectEntity.id,
                    rel.relationType
                );

                if (existingEdge) {
                    result.skipped++;
                    continue;
                }

                // Create the relationship edge using createEdge
                smartGraphRegistry.createEdge(
                    subjectEntity.id,
                    objectEntity.id,
                    rel.relationType,
                    {
                        sourceNote: rel.sourceNoteId,
                        weight: rel.confidence,
                        provenance: 'llm',
                        attributes: {
                            verb: rel.verb,
                            manner: rel.manner,
                            location: rel.location,
                            time: rel.time,
                            recipient: rel.recipient,
                            sourceSentence: rel.sourceSentence,
                        }
                    }
                );

                result.created++;
            } catch (err) {
                console.error('[LlmRelationExtractor] Failed to register relation:', rel, err);
            }
        }

        console.log(`[LlmRelationExtractor] Committed: ${result.created} created, ${result.skipped} skipped`);
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

