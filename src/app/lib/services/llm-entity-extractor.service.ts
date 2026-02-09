/**
 * LLM Entity Extractor Service
 * 
 * Extracts entities from notes using LLM and adds them to the registry.
 * 
 * Uses LlmBatchService which:
 * - Has its OWN settings (separate from AI Chat)
 * - Does NOT use streaming
 * - Returns complete responses only
 */

import { Injectable, inject, signal } from '@angular/core';
import * as ops from '../operations';
import { smartGraphRegistry } from '../registry';
import { LlmBatchService } from './llm-batch.service';
import { ENTITY_KINDS, type EntityKind, isEntityKind } from '../cozo/utils';

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

const SYSTEM_PROMPT = `You are an entity extraction assistant. Return ONLY a valid JSON array. No markdown, no explanation. Start with [ and end with ].`;

const USER_PROMPT_TEMPLATE = `Extract named entities from this text. Return a JSON array.

Each object:
- "label": Canonical name (string)
- "kind": One of: ${ENTITY_KINDS.join(', ')}
- "confidence": 0.0-1.0

KIND GUIDE:
- CHARACTER: Main characters
- NPC: Side characters
- LOCATION: Places, buildings
- ITEM: Objects, artifacts
- FACTION: Organizations, groups
- EVENT: Historical events
- CONCEPT: Magic systems, lore

Rules:
1. Only proper nouns
2. Skip generic terms
3. Deduplicate

TEXT:
`;

@Injectable({
    providedIn: 'root'
})
export class LlmEntityExtractorService {
    // Uses dedicated batch service - NOT the chat services
    private llmBatch = inject(LlmBatchService);

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
     * Extract entities from a single note's text
     */
    async extractFromNote(noteId: string, text: string): Promise<ExtractedEntity[]> {
        if (!text.trim()) return [];

        // Limit text to avoid token limits
        const truncatedText = text.substring(0, 6000);
        const userPrompt = USER_PROMPT_TEMPLATE + truncatedText;

        try {
            // Use dedicated batch service - NO STREAMING
            const response = await this.llmBatch.complete(userPrompt, SYSTEM_PROMPT);

            // Parse JSON from response
            const entities = this.parseEntityResponse(response, noteId);
            return entities;
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

    /**
     * Parse LLM response into entities
     */
    private parseEntityResponse(response: string, sourceNoteId: string): ExtractedEntity[] {
        try {
            let jsonStr = response.trim();

            // Remove markdown code block if present
            if (jsonStr.startsWith('```')) {
                const lines = jsonStr.split('\n');
                lines.shift();
                if (lines[lines.length - 1].startsWith('```')) {
                    lines.pop();
                }
                jsonStr = lines.join('\n');
            }

            // Try parsing
            let parsed: any[];
            try {
                parsed = JSON.parse(jsonStr);
            } catch {
                console.warn('[LlmEntityExtractor] JSON parse failed, attempting repair...');
                parsed = this.repairTruncatedJson(jsonStr);
            }

            if (!Array.isArray(parsed)) {
                console.warn('[LlmEntityExtractor] Response is not an array');
                return [];
            }

            const entities: ExtractedEntity[] = [];

            for (const item of parsed) {
                if (!item.label || !item.kind) continue;

                const kindUpper = String(item.kind).toUpperCase();
                if (!isEntityKind(kindUpper)) {
                    console.warn('[LlmEntityExtractor] Unknown kind:', item.kind);
                    continue;
                }

                entities.push({
                    label: String(item.label).trim(),
                    kind: kindUpper as EntityKind,
                    aliases: Array.isArray(item.aliases) ? item.aliases.map((a: any) => String(a)) : undefined,
                    confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
                    sourceNoteId
                });
            }

            console.log(`[LlmEntityExtractor] Parsed ${entities.length} entities`);
            return entities;
        } catch (err) {
            console.error('[LlmEntityExtractor] Failed to parse:', err);
            console.log('[LlmEntityExtractor] Raw response:', response.substring(0, 500));
            return [];
        }
    }

    /**
     * Attempt to repair truncated JSON
     */
    private repairTruncatedJson(jsonStr: string): any[] {
        const results: any[] = [];
        const pattern = /\{\s*"label"\s*:\s*"[^"]+"\s*,\s*"kind"\s*:\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*:\s*(?:"[^"]*"|[\d.]+|\[[^\]]*\]|true|false|null))*\s*\}/g;

        let match;
        while ((match = pattern.exec(jsonStr)) !== null) {
            try {
                const obj = JSON.parse(match[0]);
                if (obj.label && obj.kind) {
                    results.push(obj);
                }
            } catch {
                // Skip
            }
        }

        console.log(`[LlmEntityExtractor] Recovered ${results.length} entities from malformed JSON`);
        return results;
    }
}
