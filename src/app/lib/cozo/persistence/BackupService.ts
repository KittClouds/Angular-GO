/**
 * Backup Service - User-facing data export/import
 * 
 * Since OPFS is deleted when users clear site data, this provides
 * a safety net for manual backups.
 */

import { cozoDb, PERSISTED_RELATIONS } from '../db';

const LAST_BACKUP_KEY = 'cozo_last_backup_date';

export interface BackupMetadata {
    version: 1;
    createdAt: string;
    appVersion: string;
    entityCount: number;
    noteCount: number;
}

export interface BackupFile {
    metadata: BackupMetadata;
    data: string; // CozoDB export JSON string
}

export class BackupService {
    /**
     * Export all CozoDB data as a downloadable JSON file
     */
    async exportBackup(): Promise<void> {
        if (!cozoDb.isReady()) {
            throw new Error('Database not ready for export');
        }

        // Export all persisted relations
        const exportData = cozoDb.exportRelations(PERSISTED_RELATIONS);

        // Count entities and notes for metadata
        let entityCount = 0;
        let noteCount = 0;
        try {
            const entityResult = cozoDb.runQuery('?[count(id)] := *entities{id}');
            entityCount = entityResult.rows?.[0]?.[0] ?? 0;
        } catch { /* ignore */ }
        try {
            const noteResult = cozoDb.runQuery('?[count(id)] := *notes{id}');
            noteCount = noteResult.rows?.[0]?.[0] ?? 0;
        } catch { /* ignore */ }

        const backup: BackupFile = {
            metadata: {
                version: 1,
                createdAt: new Date().toISOString(),
                appVersion: '1.0.0', // TODO: get from package.json
                entityCount,
                noteCount,
            },
            data: exportData,
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `inklings-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Record last backup date
        localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
        console.log('[BackupService] Export complete');
    }

    /**
     * Import backup from a file
     * Returns the metadata of the imported backup
     */
    async importBackup(file: File): Promise<BackupMetadata> {
        const text = await file.text();
        let backup: BackupFile;

        try {
            backup = JSON.parse(text);
        } catch {
            throw new Error('Invalid backup file: not valid JSON');
        }

        if (!backup.metadata || backup.metadata.version !== 1) {
            throw new Error('Invalid backup file: unsupported version');
        }

        if (!backup.data) {
            throw new Error('Invalid backup file: no data');
        }

        if (!cozoDb.isReady()) {
            throw new Error('Database not ready for import');
        }

        // Import the data
        cozoDb.importRelations(backup.data);

        console.log(`[BackupService] Import complete: ${backup.metadata.entityCount} entities, ${backup.metadata.noteCount} notes`);
        return backup.metadata;
    }

    /**
     * Get the date of the last manual backup
     */
    getLastBackupDate(): Date | null {
        const stored = localStorage.getItem(LAST_BACKUP_KEY);
        if (!stored) return null;
        try {
            return new Date(stored);
        } catch {
            return null;
        }
    }

    /**
     * Check if a backup is recommended (e.g., > 7 days since last backup)
     */
    isBackupRecommended(daysSinceLastBackup = 7): boolean {
        const lastBackup = this.getLastBackupDate();
        if (!lastBackup) return true;

        const daysSince = (Date.now() - lastBackup.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince > daysSinceLastBackup;
    }
}

export const backupService = new BackupService();
