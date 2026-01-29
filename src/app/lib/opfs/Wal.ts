
import { BlobMeta } from './BlobStore';

export type WalOp =
    | { type: 'PutObject', id: string, kind: string, now: number }
    | { type: 'AttachBlob', objectId: string, role: string, cid: string, meta: BlobMeta }
    | { type: 'SetProp', objectId: string, key: string, value: any }
    | { type: 'AddEdge', src: string, rel: string, dst: string }
    | { type: 'DeleteObject', id: string }
    | { type: 'LegacyUpsertNote', id: string, title: string, content: string, now: number };

export class WalManager {
    static opToScript(op: WalOp): string {
        switch (op.type) {
            case 'PutObject': {
                let script = `
                    ?[id, kind, mtime, ctime] <- [[${JSON.stringify(op.id)}, ${JSON.stringify(op.kind)}, ${op.now}, ${op.now}]]
                    :put object { id, kind, mtime, ctime }
                `;

                // Legacy Sync for Notes
                // Note: We don't have the content here in PutObject op anymore? 
                // Ah, right. PutObject just sets metadata. AttachBlob sets content.
                // We need to coordinate legacy write.
                // Actually, 'notes' legacy table needs content.
                // If we split Ops, we can't easily reconstruct the single 'upsert notes' row without reading state.
                // BUT, 'notes' table usually only needs ID/Title for listing? No, it holds content.

                // Workaround: We will emit a specific "LegacyNoteUpsert" op if we want to support legacy.
                // OR we accept that 'notes' table will be partial or we update it in a separate op.

                // Let's rely on GRAPH_OBJECT_STORE doing the right thing. 
                // Creating a special Op for legacy sync might be cleaner.
                return script;
            }
            case 'AttachBlob':
                return `
                    ?[object_id, role, cid, size, mime] <- [[${JSON.stringify(op.objectId)}, ${JSON.stringify(op.role)}, ${JSON.stringify(op.cid)}, ${op.meta.size}, ${JSON.stringify(op.meta.mimeType || '')}]]
                    :put attachment { object_id, role, cid, size, mime }
                `;
            case 'SetProp':
                return `
                    ?[object_id, key, value] <- [[${JSON.stringify(op.objectId)}, ${JSON.stringify(op.key)}, ${JSON.stringify(op.value)}]]
                    :put prop { object_id, key, value }
                `;
            case 'AddEdge':
                return `
                    ?[src, rel, dst] <- [[${JSON.stringify(op.src)}, ${JSON.stringify(op.rel)}, ${JSON.stringify(op.dst)}]]
                    :put edge { src, rel, dst }
                `;
            case 'DeleteObject':
                return `
                    ?[id] <- [[${JSON.stringify(op.id)}]]
                    :rm object { id }
                    :rm prop { object_id: id }
                    :rm attachment { object_id: id }
                    // Legacy Cleanup
                    :rm notes { id }
                    :rm folders { id }
                `;
            case 'LegacyUpsertNote':
                // Custom op for back-compat
                // @ts-ignore
                const { id, title, content, now } = op;
                // NOTES_SCHEMA: id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, updated_at
                // We provide minimal set. Cozo might reject if we don't provide all or defaults?
                // Cozo :put is OK with partial if columns are nullable? No, schema defines strictly.
                // We should use what matches.
                // NOTE: ContentSchema uses :create, which implies columns are fixed.
                // If we use :put, we must match the columns defined in the relation or use a projection.
                // Let's use projection for ID, Title, Content, CreatedAt, UpdatedAt.
                // And defaults for others? Cozo Datalog requires all columns unless we use default or named args in future.
                // Actually, standard Datalog :put requires full tuple or matching projection.
                // We'll write to a subset using projection.
                return `
                    ?[id, title, content, created_at, updated_at] <- [[${JSON.stringify(id)}, ${JSON.stringify(title || '')}, ${JSON.stringify(content || '')}, ${now}, ${now}]]
                    :put notes { id, title, content, created_at, updated_at }
                 `;
            default:
                throw new Error(`Unknown op type: ${(op as any).type}`);
        }
    }
}
