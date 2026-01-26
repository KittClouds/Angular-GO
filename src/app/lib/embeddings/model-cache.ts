// src/app/lib/embeddings/model-cache.ts
// Model cache using Dexie (IndexedDB)

// Adjusted import to point to the local dexie DB definition
import { db, ModelCache as CachedModel } from '../dexie/db';

// Re-export type for consumers
export type { CachedModel };

/**
 * Model cache for ONNX embedding model files.
 * Uses Dexie (IndexedDB) for efficient binary blob storage.
 */
export const modelCache = {
    /**
     * Get a cached model by ID
     */
    async get(modelId: string): Promise<CachedModel | undefined> {
        try {
            return await db.modelCache.get(modelId);
        } catch (err) {
            console.warn('[ModelCache] Failed to get model:', err);
            return undefined;
        }
    },

    /**
     * Cache a model (ONNX binary + tokenizer JSON)
     */
    async put(modelId: string, onnx: ArrayBuffer, tokenizer: string): Promise<void> {
        try {
            await db.modelCache.put({
                modelId,
                onnx,
                tokenizer,
                timestamp: Date.now(),
            });
            console.log(`[ModelCache] Cached ${modelId} (${(onnx.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        } catch (err) {
            console.error('[ModelCache] Failed to cache model:', err);
        }
    },

    /**
     * Delete a cached model
     */
    async delete(modelId: string): Promise<void> {
        await db.modelCache.delete(modelId);
    },

    /**
     * Clear all cached models
     */
    async clear(): Promise<void> {
        await db.modelCache.clear();
    },

    /**
     * List all cached model IDs
     */
    async list(): Promise<string[]> {
        const models = await db.modelCache.toArray();
        return models.map(m => m.modelId);
    },

    /**
     * Get cache stats
     */
    async getStats(): Promise<{ count: number; totalBytes: number }> {
        const models = await db.modelCache.toArray();
        const totalBytes = models.reduce((sum, m) => sum + (m.onnx?.byteLength || 0), 0);
        return { count: models.length, totalBytes };
    }
};
