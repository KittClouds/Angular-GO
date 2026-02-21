/**
 * Bridge Module - Data Layer Orchestration
 * 
 * Architecture:
 * - GoSqliteCozoBridge: Unified facade (GoSQLite persistence)
 * - GoOpfsSyncService: Debounced OPFS persistence
 */

export * from './DataSyncService';
export { GoOpfsSyncService, type SyncStatus as OpfsSyncStatus } from '../opfs/GoOpfsSyncService';
