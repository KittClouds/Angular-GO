/**
 * AI Tool Schemas - Phase 1 & 2
 * 
 * OpenRouter-compatible tool definitions for Search, Read, Write.
 * Phase 2: RLM workspace tools for agent-style operations.
 * 
 * Tools:
 * 1. read_current_note - Read the currently open note
 * 2. read_note_by_id - Read a specific note by ID
 * 3. get_editor_selection - Get selected text and positions
 * 4. search_notes - BM25 keyword search via GoKitt ResoRank
 * 5. edit_note - Edit note content (replace selection, insert, append)
 * 6. create_note - Create a new note in a folder
 * 
 * Phase 2 - RLM Workspace Tools:
 * 7. workspace_get_index - List all artifacts in workspace
 * 8. workspace_put - Store an artifact in workspace
 * 9. workspace_pin - Pin an artifact as important
 * 10. needle_search - Search notes with snippet results
 * 11. notes_get - Get a specific note by ID
 * 12. notes_list - List notes in scope
 * 13. spans_read - Read a text span from a note
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

// -----------------------------------------------------------------------------
// RLM WORKSPACE Tools (Phase 2)
// -----------------------------------------------------------------------------

export const WorkspaceGetIndexTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'workspace_get_index',
        description: 'List all artifacts in the current workspace. Returns metadata for each artifact including key, kind, pinned status, and timestamps. Use to see what data is available in the workspace.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

export const WorkspacePutTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'workspace_put',
        description: 'Store an artifact in the workspace. Use to save intermediate results, notes, or computed data for later retrieval. Artifacts are scoped to the current thread/narrative.',
        parameters: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Unique key to identify this artifact'
                },
                kind: {
                    type: 'string',
                    description: 'Type of artifact (e.g., "snippet", "hits", "span_set", "table")'
                },
                payload: {
                    type: 'string',
                    description: 'JSON string containing the artifact data'
                }
            },
            required: ['key', 'kind', 'payload']
        }
    }
};

export const WorkspacePinTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'workspace_pin',
        description: 'Pin an artifact as important. Pinned artifacts are included in memory context for the LLM. Use to mark key findings or results that should persist.',
        parameters: {
            type: 'object',
            properties: {
                key: {
                    type: 'string',
                    description: 'Key of the artifact to pin'
                }
            },
            required: ['key']
        }
    }
};

export const NeedleSearchTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'needle_search',
        description: 'Search notes with snippet results. Returns matching notes with title, doc_id, and a text snippet. More targeted than search_notes for finding specific content.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query - text to find in notes'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum results to return (default: 10)'
                }
            },
            required: ['query']
        }
    }
};

export const NotesGetTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'notes_get',
        description: 'Get a specific note by its document ID. Returns the full note object including title and markdown content.',
        parameters: {
            type: 'object',
            properties: {
                doc_id: {
                    type: 'string',
                    description: 'The document ID of the note to retrieve'
                }
            },
            required: ['doc_id']
        }
    }
};

export const NotesListTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'notes_list',
        description: 'List notes in the current scope. Returns metadata for each note including ID and update timestamp.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

export const SpansReadTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'spans_read',
        description: 'Read a specific text span from a note. Use to extract a portion of a document without loading the entire content.',
        parameters: {
            type: 'object',
            properties: {
                doc_id: {
                    type: 'string',
                    description: 'Document ID to read from'
                },
                start: {
                    type: 'number',
                    description: 'Start character position (0-indexed)'
                },
                end: {
                    type: 'number',
                    description: 'End character position'
                },
                max_chars: {
                    type: 'number',
                    description: 'Maximum characters to return (optional limit)'
                }
            },
            required: ['doc_id', 'start', 'end']
        }
    }
};

// =============================================================================
// Tool Collection - Phase 1 & 2
// =============================================================================

export const ALL_TOOLS: ToolDefinition[] = [
    // Phase 1: Core tools
    ReadCurrentNoteTool,
    ReadNoteByIdTool,
    GetEditorSelectionTool,
    SearchNotesTool,
    EditNoteTool,
    CreateNoteTool,
    // Phase 2: RLM workspace tools
    WorkspaceGetIndexTool,
    WorkspacePutTool,
    WorkspacePinTool,
    NeedleSearchTool,
    NotesGetTool,
    NotesListTool,
    SpansReadTool
];

// Map for quick lookup
export const TOOL_MAP: Record<string, ToolDefinition> = {
    // Phase 1
    read_current_note: ReadCurrentNoteTool,
    read_note_by_id: ReadNoteByIdTool,
    get_editor_selection: GetEditorSelectionTool,
    search_notes: SearchNotesTool,
    edit_note: EditNoteTool,
    create_note: CreateNoteTool,
    // Phase 2: RLM workspace tools
    workspace_get_index: WorkspaceGetIndexTool,
    workspace_put: WorkspacePutTool,
    workspace_pin: WorkspacePinTool,
    needle_search: NeedleSearchTool,
    notes_get: NotesGetTool,
    notes_list: NotesListTool,
    spans_read: SpansReadTool
};

// =============================================================================
// Type Guards
// =============================================================================

export type ToolName =
    // Phase 1
    | 'read_current_note'
    | 'read_note_by_id'
    | 'get_editor_selection'
    | 'search_notes'
    | 'edit_note'
    | 'create_note'
    // Phase 2: RLM workspace tools
    | 'workspace_get_index'
    | 'workspace_put'
    | 'workspace_pin'
    | 'needle_search'
    | 'notes_get'
    | 'notes_list'
    | 'spans_read';

export function isValidToolName(name: string): name is ToolName {
    return name in TOOL_MAP;
}

