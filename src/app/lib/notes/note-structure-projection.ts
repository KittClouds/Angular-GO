import { db, NoteBlockProjection, NoteLineProjection } from '../dexie/db';

type JsonNode = {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    content?: JsonNode[];
};

interface ProjectionBlock {
    path: string;
    nodeType: string;
    text: string;
    headingLevel?: number;
}

interface NoteProjection {
    blocks: NoteBlockProjection[];
    lines: NoteLineProjection[];
}

interface NoteProjectionInput {
    id: string;
    content: unknown;
    markdownContent?: string;
    worldId?: string;
    folderId?: string;
    narrativeId?: string;
    version?: number;
    updatedAt?: number;
}

const PROJECTED_BLOCK_TYPES = new Set([
    'paragraph',
    'heading',
    'code_block',
    'blockquote',
    'list_item',
    'details_summary',
]);

const BOUNDARY_NODE_TYPES = new Set([
    'paragraph',
    'heading',
    'code_block',
    'blockquote',
    'list_item',
    'details_summary',
]);

export async function replaceNoteStructureProjection(note: NoteProjectionInput): Promise<void> {
    const projection = projectNoteStructure(note);
    await db.transaction('rw', db.noteBlocks, db.noteLines, async () => {
        await db.noteLines.where('noteId').equals(note.id).delete();
        await db.noteBlocks.where('noteId').equals(note.id).delete();
        if (projection.blocks.length) {
            await db.noteBlocks.bulkPut(projection.blocks);
        }
        if (projection.lines.length) {
            await db.noteLines.bulkPut(projection.lines);
        }
    });
}

export async function deleteNoteStructureProjection(noteId: string): Promise<void> {
    await deleteNoteStructureProjections([noteId]);
}

export async function deleteNoteStructureProjections(noteIds: string[]): Promise<void> {
    if (!noteIds.length) {
        return;
    }
    await db.transaction('rw', db.noteBlocks, db.noteLines, async () => {
        await db.noteLines.where('noteId').anyOf(noteIds).delete();
        await db.noteBlocks.where('noteId').anyOf(noteIds).delete();
    });
}

export function projectNoteStructure(note: NoteProjectionInput): NoteProjection {
    const sourceBlocks = parseNoteBlocks(note);
    const blocks: NoteBlockProjection[] = [];
    const lines: NoteLineProjection[] = [];
    let cursor = 0;

    sourceBlocks.forEach((source, ordinal) => {
        const text = source.text.trim();
        if (!text) {
            return;
        }
        const startOffset = cursor;
        const endOffset = startOffset + text.length;
        const blockId = `${note.id}:b:${ordinal}:${hashText(`${source.path}|${source.nodeType}`)}`;
        const blockLines = projectLines({
            blockId,
            note,
            blockOrdinal: ordinal,
            text,
            baseOffset: startOffset,
        });
        blocks.push({
            id: blockId,
            noteId: note.id,
            worldId: note.worldId || '',
            narrativeId: note.narrativeId || '',
            folderId: note.folderId || '',
            sourceVersion: note.version,
            ordinal,
            path: source.path,
            nodeType: source.nodeType,
            text,
            textHash: hashText(text),
            startOffset,
            endOffset,
            lineCount: blockLines.length,
            headingLevel: source.headingLevel,
            updatedAt: note.updatedAt || Date.now(),
        });
        lines.push(...blockLines);
        cursor = endOffset + 2;
    });

    return { blocks, lines };
}

function parseNoteBlocks(note: Pick<NoteProjectionInput, 'content' | 'markdownContent'>): ProjectionBlock[] {
    const doc = parseDocJson(note.content);
    if (doc?.type === 'doc' && Array.isArray(doc.content)) {
        const blocks: ProjectionBlock[] = [];
        collectBlocks(doc, [], blocks);
        return blocks;
    }
    return markdownBlocks(note.markdownContent || '');
}

function parseDocJson(content: unknown): JsonNode | null {
    if (!content) {
        return null;
    }
    if (typeof content === 'object') {
        return content as JsonNode;
    }
    if (typeof content !== 'string') {
        return null;
    }
    try {
        return JSON.parse(content) as JsonNode;
    } catch {
        return null;
    }
}

function collectBlocks(node: JsonNode, path: number[], blocks: ProjectionBlock[]): void {
    const nodeType = node.type || '';
    if (PROJECTED_BLOCK_TYPES.has(nodeType)) {
        const text = textContent(node).trim();
        if (text) {
            blocks.push({
                path: path.join('.'),
                nodeType,
                text,
                headingLevel: typeof node.attrs?.['level'] === 'number'
                    ? Number(node.attrs['level'])
                    : undefined,
            });
        }
        return;
    }

    node.content?.forEach((child, index) => collectBlocks(child, [...path, index], blocks));
}

function textContent(node: JsonNode): string {
    if (node.type === 'text') {
        return node.text || '';
    }
    if (node.type === 'hardbreak' || node.type === 'hardBreak' || node.type === 'hard_break') {
        return '\n';
    }
    let text = '';
    node.content?.forEach((child) => {
        const childText = textContent(child);
        if (!childText) {
            return;
        }
        if (text && BOUNDARY_NODE_TYPES.has(child.type || '') && !text.endsWith('\n')) {
            text += '\n';
        }
        text += childText;
        if (BOUNDARY_NODE_TYPES.has(child.type || '') && !text.endsWith('\n')) {
            text += '\n';
        }
    });
    return text.trimEnd();
}

function markdownBlocks(markdown: string): ProjectionBlock[] {
    return markdown
        .split(/\n{2,}/)
        .map((text, index) => ({ path: String(index), nodeType: 'markdown_block', text }))
        .filter((block) => block.text.trim().length > 0);
}

function projectLines(input: {
    blockId: string;
    note: Pick<NoteProjectionInput, 'id' | 'worldId' | 'folderId' | 'narrativeId' | 'version' | 'updatedAt'>;
    blockOrdinal: number;
    text: string;
    baseOffset: number;
}): NoteLineProjection[] {
    const lines: NoteLineProjection[] = [];
    let localOffset = 0;
    input.text.split(/\r?\n/).forEach((rawLine) => {
        const startTrim = rawLine.length - rawLine.trimStart().length;
        const text = rawLine.trim();
        if (text) {
            const startOffset = input.baseOffset + localOffset + startTrim;
            lines.push({
                id: `${input.blockId}:l:${lines.length}`,
                blockId: input.blockId,
                noteId: input.note.id,
                worldId: input.note.worldId || '',
                narrativeId: input.note.narrativeId || '',
                folderId: input.note.folderId || '',
                sourceVersion: input.note.version,
                blockOrdinal: input.blockOrdinal,
                lineOrdinal: lines.length,
                text,
                textHash: hashText(text),
                startOffset,
                endOffset: startOffset + text.length,
                updatedAt: input.note.updatedAt || Date.now(),
            });
        }
        localOffset += rawLine.length + 1;
    });
    return lines;
}

function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
