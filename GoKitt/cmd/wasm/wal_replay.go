//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
)

// storeReplayWal: [walJSON string]
// Batched replay of WAL operations for fast startup.
// Reduces bridge overhead from O(N) to O(1).
// WRAPPED IN TRANSACTION to prevent 242 fsyncs/timeouts.
func storeReplayWal(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return ErrorResult("storeReplayWal requires 1 arg: walJSON")
	}

	// 1. Unmarshal JSON (Once)
	var entries []struct {
		Op   string          `json:"op"`
		Data json.RawMessage `json:"data"`
	}

	if err := json.Unmarshal([]byte(args[0].String()), &entries); err != nil {
		return ErrorResult("invalid wal json: " + err.Error())
	}

	fmt.Printf("[GoKitt] 📦 Replaying %d WAL entries in batch...\n", len(entries))
	start := time.Now()
	successCount := 0
	errorCount := 0

	// 2. Begin Transaction (CRITICAL for Performance)
	// We access the underlying DB directly to wrap operations.
	// Note: The store methods (UpsertNote etc) use db.Exec() which will use this transaction
	// IF it's on the same connection. In database/sql, Tx binds to a connection.
	// BUT store methods call s.db.Exec(), not tx.Exec().
	// HOWEVER, since we are in WASM (single threaded, single connection usually),
	// holding a Tx on the connection *might* cause subsequent s.db.Exec to fail (busy)
	// or block.
	//
	// ACTUALLY: The safest way without refactoring Store to accept Tx is to:
	// EXECUTE SQL DIRECTLY HERE using the Tx.
	// Yes, it duplicates SQL, but it GUARANTEES the batch works.
	// Refactoring Store is too risky for this "hot fix".

	db := sqlStore.GetDB()
	tx, err := db.Begin()
	if err != nil {
		return ErrorResult("failed to begin transaction: " + err.Error())
	}

	// Ensure rollback on panic/error
	defer tx.Rollback()

	// 3. Iterate and Execute (Zero Bridge Tax + Single Transaction)
	for _, entry := range entries {
		var err error
		switch entry.Op {
		// --- Notes ---
		case "upsertNote":
			var note store.Note
			if err = json.Unmarshal(entry.Data, &note); err == nil {
				// Duplicate SQL from sqlite_store.go CreateNote/UpsertNote
				// We don't have all the private helper logic (like validation),
				// but WAL replay implies valid data from previous session.
				// For simplicity/safety, we will TRY calling the store method first.
				// If it deadlocks (because of Tx lock), we know we need raw SQL.
				// WASM sqlite driver usually allows 1 connection.
				// If we lock it with Tx, s.db.Exec might fail.
				//
				// WAIT: If we can't reuse the logic, we should probably NOT use a Tx here
				// UNLESS we copy the SQL.
				// Let's Copy the SQL for the main types. It is safer than deadlock.

				// Using raw SQL for critical path to ensure speed & transaction safety
				if note.Version == 0 {
					note.Version = 1
				}
				if note.ValidFrom == 0 {
					note.ValidFrom = note.CreatedAt
				}
				note.IsCurrent = true

				_, err = tx.Exec(`
					INSERT OR REPLACE INTO notes (id, version, world_id, title, content, markdown_content, folder_id, 
						entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, 
						narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`, note.ID, note.Version, note.WorldID, note.Title, note.Content, note.MarkdownContent,
					note.FolderID, note.EntityKind, note.EntitySubtype,
					boolToInt(note.IsEntity), boolToInt(note.IsPinned), boolToInt(note.Favorite),
					note.OwnerID, note.NarrativeID, note.Order, note.CreatedAt, note.UpdatedAt,
					note.ValidFrom, note.ValidTo, boolToInt(note.IsCurrent), note.ChangeReason)
			}
		case "deleteNote":
			var payload struct {
				ID string `json:"id"`
			}
			if err = json.Unmarshal(entry.Data, &payload); err == nil {
				_, err = tx.Exec(`DELETE FROM notes WHERE id = ?`, payload.ID)
			}

		// --- Entities ---
		case "upsertEntity":
			var entity store.Entity
			if err = json.Unmarshal(entry.Data, &entity); err == nil {
				_, err = tx.Exec(`
					INSERT OR REPLACE INTO entities (id, label, kind, subtype, aliases, first_note, 
						total_mentions, narrative_id, created_by, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`, entity.ID, entity.Label, entity.Kind, entity.Subtype, arrayToString(entity.Aliases),
					entity.FirstNote, entity.TotalMentions, entity.NarrativeID, entity.CreatedBy,
					entity.CreatedAt, entity.UpdatedAt)
			}
		case "deleteEntity":
			var payload struct {
				ID string `json:"id"`
			}
			if err = json.Unmarshal(entry.Data, &payload); err == nil {
				_, err = tx.Exec(`DELETE FROM entities WHERE id = ?`, payload.ID)
			}

		// --- Edges ---
		case "upsertEdge":
			var edge store.Edge
			if err = json.Unmarshal(entry.Data, &edge); err == nil {
				_, err = tx.Exec(`
					INSERT OR REPLACE INTO edges (id, source_id, target_id, rel_type, confidence, 
						bidirectional, source_note, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`, edge.ID, edge.SourceID, edge.TargetID, edge.RelType, edge.Confidence,
					boolToInt(edge.Bidirectional), edge.SourceNote, edge.CreatedAt)
			}
		case "deleteEdge":
			var payload struct {
				ID string `json:"id"`
			}
			if err = json.Unmarshal(entry.Data, &payload); err == nil {
				_, err = tx.Exec(`DELETE FROM edges WHERE id = ?`, payload.ID)
			}

		// --- Folders ---
		case "upsertFolder":
			var folder store.Folder
			if err = json.Unmarshal(entry.Data, &folder); err == nil {
				_, err = tx.Exec(`
					INSERT OR REPLACE INTO folders (id, name, parent_id, world_id, narrative_id, 
						folder_order, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`, folder.ID, folder.Name, folder.ParentID, folder.WorldID, folder.NarrativeID,
					folder.FolderOrder, folder.CreatedAt, folder.UpdatedAt)
			}
		case "deleteFolder":
			var payload struct {
				ID string `json:"id"`
			}
			if err = json.Unmarshal(entry.Data, &payload); err == nil {
				_, err = tx.Exec(`DELETE FROM folders WHERE id = ?`, payload.ID)
			}

		// --- Spans ---
		case "upsertSpan":
			var span store.Span
			if err = json.Unmarshal(entry.Data, &span); err == nil {
				_, err = tx.Exec(`
					INSERT OR REPLACE INTO spans (id, world_id, note_id, narrative_id, start, end, text, 
						content_hash, span_kind, status, created_by, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`, span.ID, span.WorldID, span.NoteID, span.NarrativeID, span.Start, span.End, span.Text,
					span.ContentHash, span.SpanKind, span.Status, span.CreatedBy, span.CreatedAt, span.UpdatedAt)
			}
		case "deleteSpan":
			var payload struct {
				ID string `json:"id"`
			}
			if err = json.Unmarshal(entry.Data, &payload); err == nil {
				_, err = tx.Exec(`DELETE FROM spans WHERE id = ?`, payload.ID)
			}

		default:
			// Ignore unknown ops (safe forward compatibility)
			continue
		}

		if err != nil {
			errorCount++
			fmt.Printf("[GoKitt] ⚠️ WAL Replay Error (%s): %v\n", entry.Op, err)
		} else {
			successCount++
		}
	}

	// 4. Commit Transaction
	if err := tx.Commit(); err != nil {
		return ErrorResult("failed to commit batch transaction: " + err.Error())
	}

	duration := time.Since(start).Milliseconds()
	return SuccessResult(fmt.Sprintf("Replayed %d ops in %dms (%d errors)", successCount, duration, errorCount))
}

// Helpers for raw SQL overrides
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func arrayToString(arr []string) string {
	if len(arr) == 0 {
		return "[]"
	}
	bytes, _ := json.Marshal(arr)
	return string(bytes)
}
