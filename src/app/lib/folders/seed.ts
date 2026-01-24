// src/app/lib/folders/seed.ts
// Seed default schemas on first app load

import { db } from '../dexie/db';
import { DEFAULT_FOLDER_SCHEMAS } from './default-schemas';
import { DEFAULT_NETWORK_SCHEMAS } from './default-network-schemas';

/**
 * Seed default folder and network schemas if database is empty.
 * Called once on app initialization.
 */
export async function seedDefaultSchemas(): Promise<void> {
    try {
        // Check if folder schemas exist
        const folderSchemaCount = await db.folderSchemas.count();
        if (folderSchemaCount === 0) {
            console.log('[Seed] Seeding default folder schemas...');
            await db.folderSchemas.bulkAdd(DEFAULT_FOLDER_SCHEMAS);
            console.log(`[Seed] Added ${DEFAULT_FOLDER_SCHEMAS.length} folder schemas`);
        } else {
            console.log(`[Seed] Folder schemas already exist (${folderSchemaCount})`);
        }

        // Check if network schemas exist
        const networkSchemaCount = await db.networkSchemas.count();
        if (networkSchemaCount === 0) {
            console.log('[Seed] Seeding default network schemas...');
            await db.networkSchemas.bulkAdd(DEFAULT_NETWORK_SCHEMAS);
            console.log(`[Seed] Added ${DEFAULT_NETWORK_SCHEMAS.length} network schemas`);
        } else {
            console.log(`[Seed] Network schemas already exist (${networkSchemaCount})`);
        }
    } catch (error) {
        console.error('[Seed] Failed to seed default schemas:', error);
    }
}
