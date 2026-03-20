import { Injectable, inject } from '@angular/core';
import type { Note } from '../operations';
import * as ops from '../operations';
import type { CalendarDefinition, FantasyDate } from '../fantasy-calendar/types';
import { formatFantasyDate } from '../fantasy-calendar/utils';
import { NotesService } from '../dexie/notes.service';

interface ProseMirrorNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: ProseMirrorNode[];
    text?: string;
}

interface ProseMirrorDoc {
    type: 'doc';
    content: ProseMirrorNode[];
}

export interface CalendarNoteSnapshotInput {
    noteId: string;
    calendar: CalendarDefinition;
    date: FantasyDate;
    title: string;
    description?: string;
}

export function buildCalendarEventSnapshotHeading(calendar: CalendarDefinition, date: FantasyDate): string {
    return `Event - ${formatFantasyDate(calendar, date)}`;
}

export function normalizeNoteDocument(content: unknown, markdownContent: string): ProseMirrorDoc {
    if (isDocNode(content)) {
        return JSON.parse(JSON.stringify(content)) as ProseMirrorDoc;
    }

    if (markdownContent.trim()) {
        return {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: markdownContent }],
            }],
        };
    }

    return {
        type: 'doc',
        content: [],
    };
}

export function buildCalendarEventSnapshotBlocks(
    calendar: CalendarDefinition,
    date: FantasyDate,
    title: string,
    description?: string
): ProseMirrorNode[] {
    const blocks: ProseMirrorNode[] = [
        {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: buildCalendarEventSnapshotHeading(calendar, date) }],
        },
        {
            type: 'paragraph',
            content: [{ type: 'text', text: title }],
        },
    ];

    if (description?.trim()) {
        blocks.push({
            type: 'paragraph',
            content: [{ type: 'text', text: description.trim() }],
        });
    }

    return blocks;
}

export function appendCalendarEventSnapshotToDoc(
    doc: ProseMirrorDoc,
    calendar: CalendarDefinition,
    date: FantasyDate,
    title: string,
    description?: string
): ProseMirrorDoc {
    const nextBlocks = buildCalendarEventSnapshotBlocks(calendar, date, title, description);
    const existingContent = isOnlyEmptyParagraph(doc.content) ? [] : doc.content;
    return {
        ...doc,
        content: [...existingContent, ...nextBlocks],
    };
}

export function appendCalendarEventSnapshotToMarkdown(
    markdownContent: string,
    doc: ProseMirrorDoc,
    calendar: CalendarDefinition,
    date: FantasyDate,
    title: string,
    description?: string
): string {
    const baseMarkdown = markdownContent.trim().length > 0
        ? markdownContent.trimEnd()
        : serializeDocToMarkdown(doc).trimEnd();
    const heading = buildCalendarEventSnapshotHeading(calendar, date);
    const nextSection = [
        `## ${heading}`,
        '',
        title,
        ...(description?.trim() ? ['', description.trim()] : []),
    ].join('\n');

    return baseMarkdown ? `${baseMarkdown}\n\n${nextSection}` : nextSection;
}

@Injectable({
    providedIn: 'root'
})
export class CalendarNoteSnapshotService {
    private readonly notesService = inject(NotesService);

    async appendEventSnapshot(input: CalendarNoteSnapshotInput): Promise<void> {
        const note = await ops.getNote(input.noteId);
        if (!note) {
            throw new Error(`Note ${input.noteId} was not found`);
        }

        const parsedContent = tryParseJson(note.content);
        const normalizedDoc = normalizeNoteDocument(parsedContent, note.markdownContent || '');
        const nextDoc = appendCalendarEventSnapshotToDoc(
            normalizedDoc,
            input.calendar,
            input.date,
            input.title,
            input.description
        );
        const nextMarkdown = appendCalendarEventSnapshotToMarkdown(
            note.markdownContent || '',
            normalizedDoc,
            input.calendar,
            input.date,
            input.title,
            input.description
        );

        await this.notesService.updateNote(note.id, {
            content: JSON.stringify(nextDoc),
            markdownContent: nextMarkdown,
        });
    }
}

function isDocNode(value: unknown): value is ProseMirrorDoc {
    return !!value
        && typeof value === 'object'
        && (value as ProseMirrorDoc).type === 'doc'
        && Array.isArray((value as ProseMirrorDoc).content);
}

function isOnlyEmptyParagraph(content: ProseMirrorNode[]): boolean {
    return content.length === 1
        && content[0]?.type === 'paragraph'
        && (!content[0].content || content[0].content.length === 0);
}

function tryParseJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function serializeDocToMarkdown(doc: ProseMirrorDoc): string {
    return doc.content
        .map(node => serializeBlockNode(node))
        .filter(Boolean)
        .join('\n\n');
}

function serializeBlockNode(node: ProseMirrorNode): string {
    switch (node.type) {
        case 'heading': {
            const level = typeof node.attrs?.['level'] === 'number' ? Number(node.attrs['level']) : 2;
            const text = serializeInlineContent(node.content || []);
            return text ? `${'#'.repeat(Math.max(1, level))} ${text}` : '';
        }
        case 'paragraph':
            return serializeInlineContent(node.content || []);
        case 'blockquote': {
            const text = serializeChildren(node.content || []);
            return text
                .split('\n')
                .map(line => line ? `> ${line}` : '>')
                .join('\n');
        }
        case 'bulletList':
            return (node.content || [])
                .map(item => `- ${serializeListItem(item)}`.trimEnd())
                .join('\n');
        case 'orderedList':
            return (node.content || [])
                .map((item, index) => `${index + 1}. ${serializeListItem(item)}`.trimEnd())
                .join('\n');
        case 'codeBlock':
            return ['```', serializeInlineContent(node.content || []), '```'].join('\n');
        case 'hr':
            return '---';
        default:
            return node.text || serializeChildren(node.content || []);
    }
}

function serializeChildren(nodes: ProseMirrorNode[]): string {
    return nodes
        .map(child => serializeBlockNode(child))
        .filter(Boolean)
        .join('\n');
}

function serializeListItem(node: ProseMirrorNode): string {
    const text = serializeChildren(node.content || []);
    return text.replace(/\n+/g, ' ').trim();
}

function serializeInlineContent(nodes: ProseMirrorNode[]): string {
    return nodes
        .map(node => {
            if (node.type === 'text') {
                return node.text || '';
            }

            return serializeInlineContent(node.content || []);
        })
        .join('');
}
