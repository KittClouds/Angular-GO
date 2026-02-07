/**
 * AI Tool Schemas - Phase 1
 * 
 * OpenRouter-compatible tool definitions for Search, Read, Write.
 * Phase 2 (later): Graph tools, folder tools, scan tools.
 * 
 * Tools:
 * 1. read_current_note - Read the currently open note
 * 2. read_note_by_id - Read a specific note by ID
 * 3. get_editor_selection - Get selected text and positions
 * 4. search_notes - BM25 keyword search via GoKitt ResoRank
 * 5. edit_note - Edit note content (replace selection, insert, append)
 * 6. create_note - Create a new note in a folder
 */

// =============================================================================
// Tool Definitions (OpenRouter format)
// =============================================================================

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, {
                type: string;
                description: string;
                enum?: string[];
                items?: { type: string };
            }>;
            required: string[];
        };
    };
}

// -----------------------------------------------------------------------------
// READ Tools
// -----------------------------------------------------------------------------

export const ReadCurrentNoteTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'read_current_note',
        description: 'Read the full content of the currently open note in the editor. Use this when the user asks about "this note", "my note", or references the current document. Returns soft error if no note is open.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

export const ReadNoteByIdTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'read_note_by_id',
        description: 'Read the content of a specific note by its ID. Use when you have a note_id from search results or other context.',
        parameters: {
            type: 'object',
            properties: {
                note_id: {
                    type: 'string',
                    description: 'The unique ID of the note to read'
                }
            },
            required: ['note_id']
        }
    }
};

export const GetEditorSelectionTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'get_editor_selection',
        description: 'Get the currently selected text in the editor, along with its position. Use before editing to know what the user has selected. Returns soft error if editor is not open.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

// -----------------------------------------------------------------------------
// SEARCH Tools
// -----------------------------------------------------------------------------

export const SearchNotesTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'search_notes',
        description: 'Search all notes using keyword search (BM25/ResoRank). Returns note titles, IDs, and snippets ranked by relevance. Use for finding specific terms, names, or phrases across all notes.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query - keywords to find in notes'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 5, max: 20)'
                }
            },
            required: ['query']
        }
    }
};

// -----------------------------------------------------------------------------
// WRITE Tools
// -----------------------------------------------------------------------------

export const EditNoteTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'edit_note',
        description: 'Edit the currently open note. Can replace selected text, insert at a position, or append to the end. Returns soft error if editor is not open.',
        parameters: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    description: 'The edit operation to perform',
                    enum: ['replace_selection', 'insert_at', 'append']
                },
                content: {
                    type: 'string',
                    description: 'The text content to insert or replace with'
                },
                position: {
                    type: 'number',
                    description: 'Position in document for insert_at operation (0 = start)'
                }
            },
            required: ['operation', 'content']
        }
    }
};

export const CreateNoteTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'create_note',
        description: 'Create a new note in the database. Optionally specify a folder and initial content.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Title for the new note'
                },
                content: {
                    type: 'string',
                    description: 'Initial markdown content for the note'
                },
                folder_id: {
                    type: 'string',
                    description: 'Folder ID to create note in (root if omitted)'
                }
            },
            required: ['title']
        }
    }
};

// =============================================================================
// Tool Collection - Phase 1 Only
// =============================================================================

export const ALL_TOOLS: ToolDefinition[] = [
    ReadCurrentNoteTool,
    ReadNoteByIdTool,
    GetEditorSelectionTool,
    SearchNotesTool,
    EditNoteTool,
    CreateNoteTool
];

// Map for quick lookup
export const TOOL_MAP: Record<string, ToolDefinition> = {
    read_current_note: ReadCurrentNoteTool,
    read_note_by_id: ReadNoteByIdTool,
    get_editor_selection: GetEditorSelectionTool,
    search_notes: SearchNotesTool,
    edit_note: EditNoteTool,
    create_note: CreateNoteTool
};

// =============================================================================
// Type Guards
// =============================================================================

export type ToolName =
    | 'read_current_note'
    | 'read_note_by_id'
    | 'get_editor_selection'
    | 'search_notes'
    | 'edit_note'
    | 'create_note';

export function isValidToolName(name: string): name is ToolName {
    return name in TOOL_MAP;
}

