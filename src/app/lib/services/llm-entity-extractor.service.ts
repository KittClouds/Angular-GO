/**
 * LLM Entity Extractor Service
 * 
 * Uses LLM (Google GenAI or OpenRouter) to extract entities from notes
 * and add them directly to the registry.
 */

import { Injectable, inject, signal } from '@angular/core';
import { db } from '../dexie/db';
import { smartGraphRegistry } from '../registry';
import { GoogleGenAIService } from './google-genai.service';
import { OpenRouterService } from './openrouter.service';
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

const EXTRACTION_PROMPT = `You are an entity extraction assistant for a world-building/writing application.
Extract named entities from the following text. Return ONLY a valid JSON array (no markdown, no explanation).

Each entity object must have:
- "label": The canonical name of the entity
- "kind": One of: ${ENTITY_KINDS.join(', ')}
- "aliases": Array of alternative names/nicknames (optional)
- "confidence": Number 0.0-1.0 indicating extraction confidence

ENTITY KIND GUIDE:
- CHARACTER: Main/playable characters, protagonists
- NPC: Side characters, minor characters, extras
- LOCATION: Places, regions, buildings, geographical features
- ITEM: Objects, artifacts, weapons, equipment, vehicles
- FACTION: Organizations, groups, nations, guilds, families
- EVENT: Historical events, battles, ceremonies, incidents
- CONCEPT: Abstract ideas, magic systems, lore, rules
- SCENE: Story scenes
- ARC/ACT/CHAPTER/BEAT: Story structure elements
- TIMELINE: Temporal periods
- NARRATIVE: Story/world containers

Rules:
1. Only extract proper nouns and significant named concepts
2. Do NOT extract generic words like "the city", "a warrior" - only specific names
3. Prefer CHARACTER over NPC for clearly important named characters
4. Use CONCEPT for magic systems, abilities, or abstract named things
5. Deduplicate - if "Gandalf the Grey" appears, only extract once with aliases

TEXT:
`;

@Injectable({
    providedIn: 'root'
})
export class LlmEntityExtractorService {
    private googleGenAI = inject(GoogleGenAIService);
    private openRouter = inject(OpenRouterService);

    // Extraction state
    isExtracting = signal(false);
    extractionProgress = signal({ current: 0, total: 0 });

    /**
     * Extract entities from a single note's text
     */
    async extractFromNote(noteId: string, text: string): Promise<ExtractedEntity[]> {
        if (!text.trim()) return [];

        const prompt = EXTRACTION_PROMPT + text.substring(0, 8000); // Limit context

        try {
            let response: string;

            // Prefer Google GenAI if configured, else OpenRouter
            if (this.googleGenAI.isConfigured()) {
                response = await this.googleGenAI.chat([
                    { role: 'user', parts: [{ text: prompt }] }
                ]);
            } else if (this.openRouter.isConfigured()) {
                response = await this.openRouter.chat([
                    { role: 'user', content: prompt }
                ]);
            } else {
                throw new Error('No LLM provider configured');
            }

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

            console.log(`[LlmEntityExtractor] Extracting from ${noteIds.length} notes in narrative ${narrativeId}`);

            const entityMap = new Map<string, ExtractedEntity>(); // Dedupe by normalized label

            for (let i = 0; i < noteIds.length; i++) {
                const noteId = noteIds[i];
                this.extractionProgress.set({ current: i + 1, total: noteIds.length });

                try {
                    const note = await db.notes.get(noteId);
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
    async commitToRegistry(entities: ExtractedEntity[], _narrativeId?: string): Promise<CommitResult> {
        const result: CommitResult = {
            created: 0,
            updated: 0,
            skipped: 0
        };

        for (const entity of entities) {
            // Check if already exists
            const existing = smartGraphRegistry.findEntityByLabel(entity.label);

            if (existing) {
                // Already registered - skip
                result.skipped++;
                continue;
            }

            try {
                // Register new entity
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

        // Get all folders in this narrative
        const folderIds = await this.getDescendantFolderIds(narrativeId);
        folderIds.push(narrativeId); // Include root folder

        // Get notes in each folder
        for (const folderId of folderIds) {
            const notes = await db.notes.where('folderId').equals(folderId).toArray();
            noteIds.push(...notes.map(n => n.id));
        }

        return noteIds;
    }

    /**
     * Recursively get all descendant folder IDs
     */
    private async getDescendantFolderIds(parentId: string): Promise<string[]> {
        const result: string[] = [];
        const children = await db.folders.where('parentId').equals(parentId).toArray();

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
            // Try to extract JSON from the response (might have markdown wrapping)
            let jsonStr = response.trim();

            // Remove markdown code block if present
            if (jsonStr.startsWith('```')) {
                const lines = jsonStr.split('\n');
                lines.shift(); // Remove opening ```json
                if (lines[lines.length - 1].startsWith('```')) {
                    lines.pop(); // Remove closing ```
                }
                jsonStr = lines.join('\n');
            }

            const parsed = JSON.parse(jsonStr);

            if (!Array.isArray(parsed)) {
                console.warn('[LlmEntityExtractor] Response is not an array');
                return [];
            }

            const entities: ExtractedEntity[] = [];

            for (const item of parsed) {
                if (!item.label || !item.kind) continue;

                // Normalize kind
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

            return entities;
        } catch (err) {
            console.error('[LlmEntityExtractor] Failed to parse response:', err);
            console.log('[LlmEntityExtractor] Raw response:', response.substring(0, 500));
            return [];
        }
    }
}
