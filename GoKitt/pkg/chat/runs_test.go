package chat

import (
	"context"
	"testing"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/memory"
)

func TestStartRun_DeterministicGatherersPrepareReply(t *testing.T) {
	s, err := store.NewSQLiteStoreWithDSN("file:chat_run_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("create store: %v", err)
	}

	now := time.Now().UnixMilli()
	thread := &store.Thread{
		ID:          "thread-run-1",
		WorldID:     "world-1",
		NarrativeID: "narr-1",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.CreateThread(thread); err != nil {
		t.Fatalf("create thread: %v", err)
	}

	note := &store.Note{
		ID:              "note-1",
		Version:         1,
		WorldID:         "world-1",
		Title:           "Dragon Notes",
		Content:         "A dragon guards the mountain archive.",
		MarkdownContent: "A dragon guards the mountain archive.",
		NarrativeID:     "narr-1",
		IsCurrent:       true,
		CreatedAt:       now,
		UpdatedAt:       now,
		ValidFrom:       now,
	}
	if err := s.UpsertNote(note); err != nil {
		t.Fatalf("upsert note: %v", err)
	}

	service := NewChatService(s, nil, memoryDisabledConfig())
	if _, err := service.AddUserMessage(thread.ID, "Tell me about the dragon archive", thread.NarrativeID); err != nil {
		t.Fatalf("add user message: %v", err)
	}

	run, err := service.StartRun(context.Background(), thread.ID, "Tell me about the dragon archive", store.RunOptions{
		WorkspaceEnabled: true,
		PlannerEnabled:   false,
		OMEnabled:        false,
		DeadlineMs:       2000,
		BaseSystemPrompt: "You are helpful.",
	})
	if err != nil {
		t.Fatalf("start run: %v", err)
	}

	var snapshot *store.ChatRunSnapshot
	for i := 0; i < 40; i++ {
		snapshot, err = service.PollRun(run.ID)
		if err != nil {
			t.Fatalf("poll run: %v", err)
		}
		if snapshot != nil && (snapshot.Run.Status == store.ChatRunReadyToAnswer || snapshot.Run.Status == store.ChatRunDegraded) {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	if snapshot == nil {
		t.Fatal("expected run snapshot")
	}
	if snapshot.Run.Status != store.ChatRunReadyToAnswer && snapshot.Run.Status != store.ChatRunDegraded {
		t.Fatalf("expected run to be answerable, got %s", snapshot.Run.Status)
	}
	if snapshot.Run.PreparedContext == "" {
		t.Fatal("expected prepared context to be populated")
	}

	foundThreadContext := false
	foundNoteEvidence := false
	for _, item := range snapshot.Evidence {
		if item.Source == "thread_context" {
			foundThreadContext = true
		}
		if item.Source == "search_notes_qgram" {
			foundNoteEvidence = true
		}
	}

	if !foundThreadContext {
		t.Fatal("expected thread context evidence")
	}
	if !foundNoteEvidence {
		t.Fatal("expected note search evidence")
	}
}

func memoryDisabledConfig() memory.Config {
	cfg := memory.DefaultConfig()
	cfg.Enabled = false
	return cfg
}
