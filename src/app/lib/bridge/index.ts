/**
 * Bridge Module - Data Layer Orchestration
 * 
 * Architecture:
 * - GoSqliteCozoBridge: Unified facade (GoSQLite persistence)
 * - GoOpfsSyncService: Debounced OPFS persistence
 */

export { GoSqliteCozoBridge, type BridgeStatus, type HydrationReport } from './GoSqliteCozoBridge';
export { GoOpfsSyncService, type SyncStatus as OpfsSyncStatus } from '../opfs/GoOpfsSyncService';
