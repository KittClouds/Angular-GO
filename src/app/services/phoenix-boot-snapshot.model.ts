export type PhoenixBootSnapshotRow = Record<string, unknown>;

export interface PhoenixBootSnapshotRows {
    noteHeaders: PhoenixBootSnapshotRow[];
    eventNotes: PhoenixBootSnapshotRow[];
    entities: PhoenixBootSnapshotRow[];
    edges: PhoenixBootSnapshotRow[];
    folders: PhoenixBootSnapshotRow[];
}
