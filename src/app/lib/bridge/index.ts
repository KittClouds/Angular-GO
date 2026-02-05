/**
 * Bridge Module - Dexie ↔ CozoDB synchronization layer
 */

export { DexieCozoBridge, type SyncStatus, type SyncReport } from './DexieCozoBridge';
export { NebulaCozoBridge } from './NebulaCozoBridge';
export { SyncQueue, type SyncOp, type SyncTable, type SyncQueueConfig, type SyncStats } from './SyncQueue';
export {
    DexieToCozo,
    CozoToDexie,
    CozoQueries,
    type CozoNote,
    type CozoFolder,
    type CozoEntity,
    type CozoEdge,
} from './CozoFieldMapper';
