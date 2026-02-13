/**
 * AI Tool Executor - Phase 1 & 2
 * 
 * Executes tool calls from LLM responses.
 * Phase 1: Read, Search, Write tools only.
 * Phase 2: RLM workspace tools for agent-style operations.
 * Uses GoSQLite operations (not Dexie) and EditorAgentBridge.
 */

import type { GoKittService } from '../../services/gokitt.service';
import type { ToolName } from './tool-schemas';
import { isValidToolName } from './tool-schemas';
import type { EditorAgentBridge, SelectionInfo, EditResult } from './editor-agent-bridge';
import * as ops from '../operations';

// =============================================================================
// Types
// =============================================================================

/** RLM Scope for workspace operations */
export interface RLMScope {
    threadId: string;
    narrativeId?: string;
    folderId?: string;
}

export interface ToolExecutionContext {
    goKittService: GoKittService;
    editorBridge: EditorAgentBridge;
    getCurrentNoteContent: () => string | null;
    getCurrentNoteId: () => string | null;
    getCurrentNoteTitle: () => string | null;
    /** RLM scope for workspace tools - required for Phase 2 tools */
    rlmScope?: RLMScope;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolResult {
    tool_call_id: string;
    role: 'tool';
    content: string;
}

// =============================================================================
// Tool Result Formatters
// =============================================================================

function formatNoteResult(id: string | null, title: string | null, content: string | null): string {
    if (!content) {
        return JSON.stringify({ error: 'No note is currently open', soft_error: true });
    }
    return JSON.stringify({
        note_id: id,
        title: title || 'Untitled',
        content: content.slice(0, 8000), // Limit for context window
        truncated: content.length > 8000
    });
}

function formatSearchResults(results: Array<{ id: string; title?: string; snippet?: string; score?: number }>): string {
    if (results.length === 0) {
        return JSON.stringify({ results: [], message: 'No matching notes found' });
    }
    return JSON.stringify({
        results: results.slice(0, 20).map(r => ({
            note_id: r.id,
            title: r.title || 'Untitled',
            snippet: r.snippet?.slice(0, 500) || '',
            relevance: r.score
        })),
        total: results.length
    });
}

function formatSelectionResult(selection: SelectionInfo | null): string {
    if (!selection) {
        return JSON.stringify({ error: 'Editor is not open', soft_error: true });
    }
    if (selection.empty) {
        return JSON.stringify({
            from: selection.from,
            to: selection.to,
            text: '',
            empty: true,
            message: 'No text is selected'
        });
    }
    return JSON.stringify({
        from: selection.from,
        to: selection.to,
        text: selection.text,
        empty: false,
        length: selection.text.length
    });
}

function formatEditResult(result: EditResult): string {
    if (!result.success) {
        return JSON.stringify({ error: result.error, soft_error: true });
    }
    return JSON.stringify({ success: true });
}

// =============================================================================
// Main Executor
// =============================================================================

export async function executeToolCall(
    toolCall: ToolCall,
    ctx: ToolExecutionContext
): Promise<ToolResult> {
    const toolName = toolCall.function.name;
    let args: Record<string, unknown> = {};

    try {
        args = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify({ error: 'Invalid tool arguments' })
        };
    }

    if (!isValidToolName(toolName)) {
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify({ error: `Unknown tool: ${toolName}` })
        };
    }

    console.log(`[ToolExecutor] Executing: ${toolName}`, args);

    try {
        const content = await executeByName(toolName, args, ctx);
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content
        };
    } catch (err) {
        console.error(`[ToolExecutor] Error executing ${toolName}:`, err);
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify({ error: String(err) })
        };
    }
}

async function executeByName(
    name: ToolName,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext
): Promise<string> {
    switch (name) {
        // ---------------------------------------------------------------------
        // READ Tools
        // ---------------------------------------------------------------------
        case 'read_current_note':
            return formatNoteResult(
                ctx.getCurrentNoteId(),
                ctx.getCurrentNoteTitle(),
                ctx.getCurrentNoteContent()
            );

        case 'read_note_by_id': {
            const noteId = String(args['note_id'] || '');
            if (!noteId.trim()) {
                return JSON.stringify({ error: 'note_id is required' });
            }

            // Fetch from Nebula
            const note = await ops.getNote(noteId);
            if (!note) {
                return JSON.stringify({ error: `Note not found: ${noteId}` });
            }

            return JSON.stringify({
                note_id: note.id,
                title: note.title || 'Untitled',
                content: (note.markdownContent || '').slice(0, 8000),
                truncated: (note.markdownContent?.length || 0) > 8000,
                folder_id: note.folderId || null
            });
        }

        case 'get_editor_selection':
            return formatSelectionResult(ctx.editorBridge.getSelection());

        // ---------------------------------------------------------------------
        // SEARCH Tools
        // ---------------------------------------------------------------------
        case 'search_notes': {
            const query = String(args['query'] || '');
            const limit = Math.min(Number(args['limit']) || 5, 20);

            if (!query.trim()) {
                return JSON.stringify({ error: 'Query is required' });
            }

            const results = await ctx.goKittService.search(query, limit);
            return formatSearchResults(results);
        }

        // ---------------------------------------------------------------------
        // WRITE Tools
        // ---------------------------------------------------------------------
        case 'edit_note': {
            const operation = String(args['operation'] || '');
            const content = String(args['content'] || '');

            if (!operation) {
                return JSON.stringify({ error: 'operation is required' });
            }
            if (!content) {
                return JSON.stringify({ error: 'content is required' });
            }

            let result: EditResult;

            switch (operation) {
                case 'replace_selection':
                    result = ctx.editorBridge.replaceSelection(content);
                    break;
                case 'insert_at': {
                    const position = Number(args['position']) || 0;
                    result = ctx.editorBridge.insertAt(position, content);
                    break;
                }
                case 'append':
                    result = ctx.editorBridge.append(content);
                    break;
                default:
                    return JSON.stringify({ error: `Unknown operation: ${operation}` });
            }

            return formatEditResult(result);
        }

        case 'create_note': {
            const title = String(args['title'] || '').trim();
            if (!title) {
                return JSON.stringify({ error: 'title is required' });
            }

            const content = String(args['content'] || '');
            const folderId = String(args['folder_id'] || '');

            // Create note via operations
            // Must provide all required Note fields
            const noteId = await ops.createNote({
                title,
                content: content ? JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] }) : '',
                markdownContent: content,
                folderId: folderId || '',
                narrativeId: '',
                worldId: '',
                entityKind: '',
                entitySubtype: '',
                isEntity: false,
                isPinned: false,
                favorite: false,
                ownerId: ''
            });

            return JSON.stringify({
                success: true,
                note_id: noteId,
                title,
                message: `Created note "${title}"`
            });
        }

        // ---------------------------------------------------------------------
        // RLM WORKSPACE Tools (Phase 2)
        // ---------------------------------------------------------------------
        case 'workspace_get_index': {
            if (!ctx.rlmScope?.threadId) {
                return JSON.stringify({ error: 'RLM scope not configured - threadId required' });
            }

            const request = {
                scope: {
                    thread_id: ctx.rlmScope.threadId,
                    narrative_id: ctx.rlmScope.narrativeId || '',
                    folder_id: ctx.rlmScope.folderId || ''
                },
                current_task: 'get_workspace_index',
                workspace_plan: '',
                actions: [{ op: 'workspace.get_index', args: {}, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            if (result.results?.[0]?.ok) {
                return JSON.stringify({ artifacts: result.results[0].payload || [] });
            }
            return JSON.stringify({ error: result.results?.[0]?.error || 'Failed to get workspace index' });
        }

        case 'workspace_put': {
            if (!ctx.rlmScope?.threadId) {
                return JSON.stringify({ error: 'RLM scope not configured - threadId required' });
            }

            const key = String(args['key'] || '');
            const kind = String(args['kind'] || '');
            const payload = String(args['payload'] || '');

            if (!key || !kind || !payload) {
                return JSON.stringify({ error: 'key, kind, and payload are required' });
            }

            const request = {
                scope: {
                    thread_id: ctx.rlmScope.threadId,
                    narrative_id: ctx.rlmScope.narrativeId || '',
                    folder_id: ctx.rlmScope.folderId || ''
                },
                current_task: 'store_artifact',
                workspace_plan: '',
                actions: [{ op: 'workspace.put', args: { key, kind, payload }, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            return JSON.stringify({
                success: result.results?.[0]?.ok || false,
                error: result.results?.[0]?.error
            });
        }

        case 'workspace_pin': {
            if (!ctx.rlmScope?.threadId) {
                return JSON.stringify({ error: 'RLM scope not configured - threadId required' });
            }

            const key = String(args['key'] || '');
            if (!key) {
                return JSON.stringify({ error: 'key is required' });
            }

            const request = {
                scope: {
                    thread_id: ctx.rlmScope.threadId,
                    narrative_id: ctx.rlmScope.narrativeId || '',
                    folder_id: ctx.rlmScope.folderId || ''
                },
                current_task: 'pin_artifact',
                workspace_plan: '',
                actions: [{ op: 'workspace.pin', args: { key }, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            return JSON.stringify({
                success: result.results?.[0]?.ok || false,
                error: result.results?.[0]?.error
            });
        }

        case 'needle_search': {
            if (!ctx.rlmScope?.threadId) {
                return JSON.stringify({ error: 'RLM scope not configured - threadId required' });
            }

            const query = String(args['query'] || '');
            const limit = Number(args['limit']) || 10;

            if (!query) {
                return JSON.stringify({ error: 'query is required' });
            }

            const request = {
                scope: {
                    thread_id: ctx.rlmScope.threadId,
                    narrative_id: ctx.rlmScope.narrativeId || '',
                    folder_id: ctx.rlmScope.folderId || ''
                },
                current_task: 'search_notes',
                workspace_plan: '',
                actions: [{ op: 'needle.search', args: { query, limit }, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            if (result.results?.[0]?.ok) {
                return JSON.stringify({ hits: result.results[0].payload || [] });
            }
            return JSON.stringify({ error: result.results?.[0]?.error || 'Search failed' });
        }

        case 'notes_get': {
            const docId = String(args['doc_id'] || '');
            if (!docId) {
                return JSON.stringify({ error: 'doc_id is required' });
            }

            const request = {
                scope: { thread_id: '', narrative_id: '', folder_id: '' },
                current_task: 'get_note',
                workspace_plan: '',
                actions: [{ op: 'notes.get', args: { doc_id: docId }, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            if (result.results?.[0]?.ok && result.results[0].payload) {
                const note = result.results[0].payload;
                return JSON.stringify({
                    doc_id: note.id,
                    title: note.title || 'Untitled',
                    content: (note.markdownContent || '').slice(0, 8000),
                    truncated: (note.markdownContent?.length || 0) > 8000
                });
            }
            return JSON.stringify({ error: result.results?.[0]?.error || 'Note not found' });
        }

        case 'notes_list': {
            if (!ctx.rlmScope?.threadId) {
                return JSON.stringify({ error: 'RLM scope not configured - threadId required' });
            }

            const request = {
                scope: {
                    thread_id: ctx.rlmScope.threadId,
                    narrative_id: ctx.rlmScope.narrativeId || '',
                    folder_id: ctx.rlmScope.folderId || ''
                },
                current_task: 'list_notes',
                workspace_plan: '',
                actions: [{ op: 'notes.list', args: {}, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            if (result.results?.[0]?.ok) {
                return JSON.stringify({ notes: result.results[0].payload || [] });
            }
            return JSON.stringify({ error: result.results?.[0]?.error || 'Failed to list notes' });
        }

        case 'spans_read': {
            const docId = String(args['doc_id'] || '');
            const start = Number(args['start']) || 0;
            const end = Number(args['end']) || 0;
            const maxChars = Number(args['max_chars']) || 0;

            if (!docId) {
                return JSON.stringify({ error: 'doc_id is required' });
            }
            if (end <= start) {
                return JSON.stringify({ error: 'end must be greater than start' });
            }

            const request = {
                scope: { thread_id: '', narrative_id: '', folder_id: '' },
                current_task: 'read_span',
                workspace_plan: '',
                actions: [{ op: 'spans.read', args: { doc_id: docId, start, end, max_chars: maxChars }, save_as: '' }]
            };

            const response = await ctx.goKittService.rlmExecute(JSON.stringify(request));
            const result = JSON.parse(response);

            if (result.results?.[0]?.ok && result.results[0].payload) {
                const span = result.results[0].payload;
                return JSON.stringify({
                    doc_id: span.doc_id,
                    start: span.start,
                    end: span.end,
                    text: span.text
                });
            }
            return JSON.stringify({ error: result.results?.[0]?.error || 'Failed to read span' });
        }

        default:
            return JSON.stringify({ error: `Tool not implemented: ${name}` });
    }
}

// =============================================================================
// Batch Executor
// =============================================================================

export async function executeToolCalls(
    toolCalls: ToolCall[],
    ctx: ToolExecutionContext
): Promise<ToolResult[]> {
    // Execute all tools in parallel
    return Promise.all(toolCalls.map(tc => executeToolCall(tc, ctx)));
}

