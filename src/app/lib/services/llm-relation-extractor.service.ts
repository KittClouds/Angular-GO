/**
 * LLM Relationship Extractor Service
 * 
 * Extracts relationships between entities from notes using LLM.
 * Works alongside LlmEntityExtractorService to build the knowledge graph.
 * 
 * Phase 1 of CST-LLM Integration:
 * - LLM extracts relationships from prose
 * - Uses known entities to prime the extraction
 * - Outputs QuadPlus-compatible relationships with modifiers
 */

import { Injectable, inject, signal } from '@angular/core';
import * as ops from '../operations';
import { smartGraphRegistry } from '../registry';
import { LlmBatchService } from './llm-batch.service';
import { ENTITY_KINDS, type EntityKind, isEntityKind } from '../cozo/utils';
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
// Relationship Types from GoKitt's verb lexicon
// ============================================================================

const RELATION_TYPES = [
    // Hierarchy
    'LEADS', 'MEMBER_OF', 'REPORTS_TO', 'COMMANDS',
    // Social
    'ALLIED_WITH', 'ENEMY_OF', 'FRIEND_OF', 'RIVAL_OF',
    // Conflict
    'BATTLES', 'DEFEATS', 'KILLED_BY', 'CAPTURES', 'CAPTIVE_OF',
    // Possession
    'OWNS', 'CREATED', 'DESTROYED', 'USES',
    // Location
    'LOCATED_IN', 'TRAVELED_TO', 'ORIGINATES_FROM',
    // Knowledge
    'KNOWS', 'TEACHES', 'LEARNED_FROM',
    // Communication
    'SPEAKS_TO', 'MENTIONS', 'REVEALS',
    // State Change
    'BECOMES', 'TRANSFORMS_INTO', 'INHERITS_FROM',
    // Participation
    'PARTICIPATES_IN', 'WITNESSES', 'CAUSES',
] as const;

type RelationType = typeof RELATION_TYPES[number];

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a relationship extraction assistant for narrative analysis.
Extract relationships between named entities from text.
Return ONLY a valid JSON array. No markdown, no explanation. Start with [ and end with ].`;

const buildUserPrompt = (text: string, knownEntities: string[]) => `
Extract relationships between entities from this text. Return a JSON array.

${knownEntities.length > 0 ? `KNOWN ENTITIES (prioritize these):
${knownEntities.join(', ')}

` : ''}RELATIONSHIP TYPES:
${RELATION_TYPES.join(', ')}

Each object in the array:
- "subject": Entity performing the action (string)
- "object": Entity receiving the action (string)  
- "verb": The verb phrase from the text (string)
- "relationType": One of the relationship types above (string)
- "manner": Optional - how the action was performed (string)
- "location": Optional - where it happened (string)
- "time": Optional - when it happened (string)
- "recipient": Optional - for communication verbs, who was told (string)
- "confidence": 0.0-1.0 (number)
- "sourceSentence": The exact sentence this came from (string)

RULES:
1. Only extract relationships between named entities (proper nouns)
2. One relationship per verb phrase
3. Include the exact source sentence for validation
4. confidence >= 0.8 for explicit statements, 0.5-0.8 for implied

TEXT:
${text}`;

// ============================================================================
// Service
// ============================================================================

@Injectable({
    providedIn: 'root'
})
export class LlmRelationExtractorService {
    private llmBatch = inject(LlmBatchService);
    private goKitt = inject(GoKittService);

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
     * Extract relationships from a single note's text
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

        // Limit text to avoid token limits
        const truncatedText = text.substring(0, 8000);
        const userPrompt = buildUserPrompt(truncatedText, knownEntities);

        try {
            const response = await this.llmBatch.complete(userPrompt, SYSTEM_PROMPT);
            const relations = this.parseRelationResponse(response, noteId);
            return relations;
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

    /**
     * Parse LLM response into relations
     */
    private parseRelationResponse(response: string, sourceNoteId: string): ExtractedRelation[] {
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
                console.warn('[LlmRelationExtractor] JSON parse failed, attempting repair...');
                parsed = this.repairTruncatedJson(jsonStr);
            }

            if (!Array.isArray(parsed)) {
                console.warn('[LlmRelationExtractor] Response is not an array');
                return [];
            }

            const relations: ExtractedRelation[] = [];

            for (const item of parsed) {
                // Validate required fields
                if (!item.subject || !item.object || !item.relationType) {
                    continue;
                }

                // Normalize relation type
                const relType = String(item.relationType).toUpperCase().replace(/ /g, '_');

                // Validate relation type (allow unknown types for flexibility)
                if (!RELATION_TYPES.includes(relType as any)) {
                    console.log(`[LlmRelationExtractor] Non-standard relation type: ${relType}`);
                }

                relations.push({
                    subject: String(item.subject).trim(),
                    subjectKind: item.subjectKind ? this.parseKind(item.subjectKind) : undefined,
                    object: String(item.object).trim(),
                    objectKind: item.objectKind ? this.parseKind(item.objectKind) : undefined,
                    verb: item.verb ? String(item.verb).trim() : relType.toLowerCase().replace(/_/g, ' '),
                    relationType: relType,
                    manner: item.manner ? String(item.manner).trim() : undefined,
                    location: item.location ? String(item.location).trim() : undefined,
                    time: item.time ? String(item.time).trim() : undefined,
                    recipient: item.recipient ? String(item.recipient).trim() : undefined,
                    confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
                    sourceSentence: item.sourceSentence ? String(item.sourceSentence) : '',
                    sourceNoteId
                });
            }

            console.log(`[LlmRelationExtractor] Parsed ${relations.length} relations`);
            return relations;
        } catch (err) {
            console.error('[LlmRelationExtractor] Failed to parse:', err);
            console.log('[LlmRelationExtractor] Raw response:', response.substring(0, 500));
            return [];
        }
    }

    /**
     * Parse entity kind string
     */
    private parseKind(kind: string): EntityKind | undefined {
        const upper = String(kind).toUpperCase();
        return isEntityKind(upper) ? upper as EntityKind : undefined;
    }

    /**
     * Attempt to repair truncated JSON
     */
    private repairTruncatedJson(jsonStr: string): any[] {
        const results: any[] = [];

        // Match complete relation objects
        const pattern = /\{\s*"subject"\s*:\s*"[^"]+"\s*,\s*"object"\s*:\s*"[^"]+"\s*,\s*"relationType"\s*:\s*"[^"]+"\s*(?:,\s*"[^"]+"\s*:\s*(?:"[^"]*"|[\d.]+|\[[^\]]*\]|true|false|null))*\s*\}/g;

        let match;
        while ((match = pattern.exec(jsonStr)) !== null) {
            try {
                const obj = JSON.parse(match[0]);
                if (obj.subject && obj.object && obj.relationType) {
                    results.push(obj);
                }
            } catch {
                // Skip malformed
            }
        }

        console.log(`[LlmRelationExtractor] Recovered ${results.length} relations from malformed JSON`);
        return results;
    }
}
