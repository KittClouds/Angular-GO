package store

import (
	"testing"
	"time"
)

// =============================================================================
// Observational Memory Tests (Phase 8)
// =============================================================================

func TestOMRecordCRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	threadID := "thread-om-test-1"
	now := time.Now().Unix()

	// Create: Upsert a new OMRecord
	record := &OMRecord{
		ThreadID:       threadID,
		Observations:   "User is working on a Go WASM project. They prefer functional programming.",
		CurrentTask:    "Implementing Observational Memory",
		LastObservedAt: now,
		ObsTokenCount:  150,
		GenerationNum:  0,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := s.UpsertOMRecord(record); err != nil {
		t.Fatalf("UpsertOMRecord failed: %v", err)
	}

	// Read: Get the record back
	got, err := s.GetOMRecord(threadID)
	if err != nil {
		t.Fatalf("GetOMRecord failed: %v", err)
	}
	if got == nil {
		t.Fatal("GetOMRecord returned nil")
	}
	if got.ThreadID != record.ThreadID {
		t.Errorf("ThreadID mismatch: got %s, want %s", got.ThreadID, record.ThreadID)
	}
	if got.Observations != record.Observations {
		t.Errorf("Observations mismatch: got %s, want %s", got.Observations, record.Observations)
	}
	if got.CurrentTask != record.CurrentTask {
		t.Errorf("CurrentTask mismatch: got %s, want %s", got.CurrentTask, record.CurrentTask)
	}
	if got.ObsTokenCount != record.ObsTokenCount {
		t.Errorf("ObsTokenCount mismatch: got %d, want %d", got.ObsTokenCount, record.ObsTokenCount)
	}

	// Update: Upsert with new observations
	record.Observations = "User is working on Go WASM. They like TDD. They use Angular."
	record.CurrentTask = "Writing OM tests"
	record.ObsTokenCount = 200
	record.GenerationNum = 1
	record.UpdatedAt = time.Now().Unix()

	if err := s.UpsertOMRecord(record); err != nil {
		t.Fatalf("UpsertOMRecord update failed: %v", err)
	}

	got, _ = s.GetOMRecord(threadID)
	if got.Observations != record.Observations {
		t.Errorf("Updated Observations mismatch: got %s, want %s", got.Observations, record.Observations)
	}
	if got.GenerationNum != 1 {
		t.Errorf("GenerationNum should be 1, got %d", got.GenerationNum)
	}

	// Delete
	if err := s.DeleteOMRecord(threadID); err != nil {
		t.Fatalf("DeleteOMRecord failed: %v", err)
	}

	got, _ = s.GetOMRecord(threadID)
	if got != nil {
		t.Error("Record should be deleted")
	}
}

func TestOMGenerationHistory(t *testing.T) {
	s, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	threadID := "thread-gen-test-1"
	now := time.Now().Unix()

	// Add multiple generations
	gen1 := &OMGeneration{
		ID:           "gen-1",
		ThreadID:     threadID,
		Generation:   1,
		InputTokens:  4500,
		OutputTokens: 1200,
		InputText:    "Long observations text that exceeded threshold...",
		OutputText:   "Condensed observations...",
		CreatedAt:    now,
	}

	gen2 := &OMGeneration{
		ID:           "gen-2",
		ThreadID:     threadID,
		Generation:   2,
		InputTokens:  5200,
		OutputTokens: 1100,
		InputText:    "Another long observations text...",
		OutputText:   "Further condensed...",
		CreatedAt:    now + 1000,
	}

	if err := s.AddOMGeneration(gen1); err != nil {
		t.Fatalf("AddOMGeneration gen1 failed: %v", err)
	}
	if err := s.AddOMGeneration(gen2); err != nil {
		t.Fatalf("AddOMGeneration gen2 failed: %v", err)
	}

	// Query generations
	generations, err := s.GetOMGenerations(threadID)
	if err != nil {
		t.Fatalf("GetOMGenerations failed: %v", err)
	}

	if len(generations) != 2 {
		t.Fatalf("Expected 2 generations, got %d", len(generations))
	}

	// Should be ordered by generation
	if generations[0].Generation != 1 {
		t.Errorf("First generation should be 1, got %d", generations[0].Generation)
	}
	if generations[1].Generation != 2 {
		t.Errorf("Second generation should be 2, got %d", generations[1].Generation)
	}

	// Verify content
	if generations[0].InputTokens != 4500 {
		t.Errorf("InputTokens mismatch: got %d, want 4500", generations[0].InputTokens)
	}
	if generations[1].OutputText != "Further condensed..." {
		t.Errorf("OutputText mismatch: got %s", generations[1].OutputText)
	}
}

func TestOMRecordDefault(t *testing.T) {
	s, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Get non-existent record should return nil, not error
	got, err := s.GetOMRecord("nonexistent-thread")
	if err != nil {
		t.Fatalf("GetOMRecord for nonexistent should not error: %v", err)
	}
	if got != nil {
		t.Error("GetOMRecord for nonexistent should return nil")
	}
}

func TestExportImport(t *testing.T) {
	// Initialize store (in-memory)
	s, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Create some data
	note := &Note{
		ID:        "note1",
		Title:     "Test Note",
		Content:   "Content",
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		IsCurrent: true,
		Version:   1,
		WorldID:   "world1",
	}
	if err := s.UpsertNote(note); err != nil {
		t.Fatalf("Failed to upsert note: %v", err)
	}

	folder := &Folder{
		ID:        "folder1",
		Name:      "Test Folder",
		WorldID:   "world1",
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
	}
	if err := s.UpsertFolder(folder); err != nil {
		t.Fatalf("Failed to upsert folder: %v", err)
	}

	// Export
	data, err := s.Export()
	if err != nil {
		t.Fatalf("Export failed: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("Exported data is empty")
	}

	// Create a NEW store to simulate a fresh start/reload
	s2, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create second store: %v", err)
	}

	// Import
	if err := s2.Import(data); err != nil {
		t.Fatalf("Import failed: %v", err)
	}

	// Verify data in new store
	restoredNote, err := s2.GetNote("note1")
	if err != nil {
		t.Fatalf("Failed to get restored note: %v", err)
	}
	if restoredNote.Title != note.Title {
		t.Errorf("Expected title %s, got %s", note.Title, restoredNote.Title)
	}

	folders, err := s2.ListFolders("")
	if err != nil {
		t.Fatalf("Failed to list folders: %v", err)
	}
	if len(folders) != 1 {
		t.Errorf("Expected 1 folder, got %d", len(folders))
	}
	if folders[0].Name != folder.Name {
		t.Errorf("Expected folder name %s, got %s", folder.Name, folders[0].Name)
	}
}

func TestFolderCRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}

	// Create
	f1 := &Folder{
		ID:      "f1",
		Name:    "Folder 1",
		WorldID: "w1",
	}
	if err := s.UpsertFolder(f1); err != nil {
		t.Fatalf("UpsertFolder failed: %v", err)
	}

	// Read
	folders, err := s.ListFolders("")
	if err != nil {
		t.Fatalf("ListFolders failed: %v", err)
	}
	if len(folders) != 1 || folders[0].ID != "f1" {
		t.Errorf("ListFolders mismatch")
	}

	// Update
	f1.Name = "Folder 1 Updated"
	if err := s.UpsertFolder(f1); err != nil {
		t.Fatalf("UpsertFolder update failed: %v", err)
	}
	folders, _ = s.ListFolders("")
	if folders[0].Name != "Folder 1 Updated" {
		t.Errorf("Folder update not persisted")
	}

	// Delete
	if err := s.DeleteFolder("f1"); err != nil {
		t.Fatalf("DeleteFolder failed: %v", err)
	}
	folders, _ = s.ListFolders("")
	if len(folders) != 0 {
		t.Errorf("Folder not deleted")
	}
}
