# Agent Tools v2 - Phased Implementation

## Phase 1: Core (NOW)
Search, Read, Write only. No graph, no auto-scan.

### Tools
| Tool | Domain | Description |
|------|--------|-------------|
| `read_current_note` | Read | Get active note content (soft error if closed) |
| `read_note_by_id` | Read | Get specific note by ID from Nebula |
| `get_editor_selection` | Read | Get selected text + positions |
| `search_notes` | Search | BM25/ResoRank keyword search |
| `edit_note` | Write | Replace selection, insert at position, append |
| `create_note` | Write | Create new note in folder |

### Data Layer
- NebulaDB via `nebula/operations.ts`
- EditorAgentBridge for live edits
- Soft errors for closed editor (no fallback)

---

## Phase 2: Later
- `list_entities` - List entities from GraphRegistry
- `get_entity_info` - Entity details + relationships
- `create_entity` - Register new entity
- `create_relationship` - Add relationship edge
- `query_graph` - Datalog traversal
- `list_folders` - Folder tree
- `create_folder` - New folder
- `scan_note` - Extract entities/relationships
