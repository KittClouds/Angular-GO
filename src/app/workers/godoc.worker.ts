/// <reference lib="webworker" />
/**
 * CrossDoc (GoDoc) Entity Linking Worker
 * 
 * Lightweight worker dedicated to cross-document entity linking.
 * Uses MDBR-Leaf (256d, 23M params) - small, fast, perfect for entity similarity.
 * 
 * SEPARATE from RAG worker which uses heavier models for semantic search.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

// ============================================================================
// Types
// ============================================================================

type CrossDocMessage =
    | { type: 'INIT' }
    | { type: 'EMBED_ENTITIES'; payload: { noteId: string; noteTitle: string; entities: ExtractedEntity[] } }
    | { type: 'EMBED_TEXT'; payload: { text: string } }
    | { type: 'EMBED_BATCH'; payload: { texts: string[] } }
    | { type: 'GET_STATUS' };

interface ExtractedEntity {
    id: string;
    label: string;
    kind: string;
    contextBefore?: string;
    contextAfter?: string;
}

type ResponseMessage =
    | { type: 'INIT_COMPLETE'; payload: { modelId: string; dimensions: number } }
    | { type: 'ENTITIES_EMBEDDED'; payload: { noteId: string; embeddings: EntityEmbedding[] } }
    | { type: 'EMBED_RESULT'; payload: { embedding: number[] } }
    | { type: 'BATCH_RESULT'; payload: { embeddings: number[][] } }
    | { type: 'STATUS'; payload: WorkerStatus }
    | { type: 'ERROR'; payload: { message: string } };

interface EntityEmbedding {
    entityId: string;
    embedding: number[];
    contextText: string;
}

interface WorkerStatus {
    initialized: boolean;
    modelLoaded: boolean;
    modelId: string;
    dimensions: number;
}

// ============================================================================
// Configuration
// ============================================================================

// MDBR-Leaf: 256 dimensions, 23M params - lightweight and fast
const MODEL_CONFIG = {
    modelId: 'MongoDB/mdbr-leaf-ir',
    dimensions: 256,
    maxTokens: 512,
    quantized: true,  // Use quantized for even faster inference
};

// ============================================================================
// Worker State
// ============================================================================

let initialized = false;
let embeddingPipeline: FeatureExtractionPipeline | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build context text for entity embedding
 */
function buildEntityContext(entity: ExtractedEntity, noteTitle: string): string {
    const parts: string[] = [];
    parts.push(`Entity: ${entity.label}`);
    parts.push(`Type: ${entity.kind}`);
    parts.push(`Source: ${noteTitle}`);
    if (entity.contextBefore) parts.push(`Context: ${entity.contextBefore}`);
    if (entity.contextAfter) parts.push(`${entity.contextAfter}`);
    return parts.join(' | ');
}

/**
 * Generate embedding for text
 */
async function embed(text: string): Promise<number[]> {
    if (!embeddingPipeline) {
        throw new Error('Model not loaded');
    }

    const output = await embeddingPipeline(text, {
        pooling: 'mean',
        normalize: true,
    });

    return Array.from(output.data);
}

/**
 * Batch embed multiple texts
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
    if (!embeddingPipeline) {
        throw new Error('Model not loaded');
    }

    const results: number[][] = [];

    // Process in small batches to avoid memory issues
    const batchSize = 8;
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        for (const text of batch) {
            const output = await embeddingPipeline(text, {
                pooling: 'mean',
                normalize: true,
            });
            results.push(Array.from(output.data));
        }
    }

    return results;
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (e: MessageEvent<CrossDocMessage>) => {
    const msg = e.data;
    console.log('[GoDocWorker] Received:', msg.type);

    try {
        switch (msg.type) {
            case 'INIT': {
                if (!initialized) {
                    console.log(`[GoDocWorker] Loading model: ${MODEL_CONFIG.modelId}`);
                    const startTime = performance.now();

                    embeddingPipeline = await pipeline(
                        'feature-extraction',
                        MODEL_CONFIG.modelId,
                        { quantized: MODEL_CONFIG.quantized }
                    ) as FeatureExtractionPipeline;

                    initialized = true;
                    const elapsed = performance.now() - startTime;
                    console.log(`[GoDocWorker] ✓ Model loaded in ${elapsed.toFixed(0)}ms`);
                }

                self.postMessage({
                    type: 'INIT_COMPLETE',
                    payload: {
                        modelId: MODEL_CONFIG.modelId,
                        dimensions: MODEL_CONFIG.dimensions,
                    }
                } as ResponseMessage);
                break;
            }

            case 'EMBED_ENTITIES': {
                const { noteId, noteTitle, entities } = msg.payload;
                console.log(`[GoDocWorker] Embedding ${entities.length} entities from: ${noteTitle}`);

                const embeddings: EntityEmbedding[] = [];

                for (const entity of entities) {
                    try {
                        const contextText = buildEntityContext(entity, noteTitle);
                        const embedding = await embed(contextText);

                        embeddings.push({
                            entityId: entity.id,
                            embedding,
                            contextText,
                        });
                    } catch (err) {
                        console.warn(`[GoDocWorker] Failed to embed ${entity.id}:`, err);
                    }
                }

                console.log(`[GoDocWorker] Embedded ${embeddings.length}/${entities.length} entities`);

                self.postMessage({
                    type: 'ENTITIES_EMBEDDED',
                    payload: { noteId, embeddings }
                } as ResponseMessage);
                break;
            }

            case 'EMBED_TEXT': {
                const embedding = await embed(msg.payload.text);
                self.postMessage({
                    type: 'EMBED_RESULT',
                    payload: { embedding }
                } as ResponseMessage);
                break;
            }

            case 'EMBED_BATCH': {
                const embeddings = await embedBatch(msg.payload.texts);
                self.postMessage({
                    type: 'BATCH_RESULT',
                    payload: { embeddings }
                } as ResponseMessage);
                break;
            }

            case 'GET_STATUS': {
                self.postMessage({
                    type: 'STATUS',
                    payload: {
                        initialized,
                        modelLoaded: embeddingPipeline !== null,
                        modelId: MODEL_CONFIG.modelId,
                        dimensions: MODEL_CONFIG.dimensions,
                    }
                } as ResponseMessage);
                break;
            }
        }
    } catch (e) {
        console.error('[GoDocWorker] Error:', e);
        self.postMessage({
            type: 'ERROR',
            payload: { message: e instanceof Error ? e.message : String(e) }
        } as ResponseMessage);
    }
};

console.log('[GoDocWorker] Worker loaded - MDBR-Leaf model (256d, lightweight)');
