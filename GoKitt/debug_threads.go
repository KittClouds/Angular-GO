package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
)

func main() {
	db, err := store.NewSQLiteStore()
	if err != nil {
		log.Fatalf("Failed to init db: %v", err)
	}

	// 1. Initial export
	export1, err := db.Export()
	if err != nil {
		log.Fatalf("Failed export 1: %v", err)
	}
	fmt.Printf("Initial export size: %d\n", len(export1))

	// 2. Create thread
	thread := &store.Thread{
		ID:          "thread-123",
		WorldID:     "test-world",
		NarrativeID: "",
		Title:       "Test thread",
		CreatedAt:   time.Now().UnixNano() / 1e6,
		UpdatedAt:   time.Now().UnixNano() / 1e6,
	}
	if err := db.CreateThread(thread); err != nil {
		log.Fatalf("Failed to create thread: %v", err)
	}

	// 3. Add Message
	msg := &store.ThreadMessage{
		ID:          "msg-456",
		ThreadID:    "thread-123",
		Role:        "user",
		Content:     "Hello OPFS",
		NarrativeID: "",
		CreatedAt:   time.Now().UnixNano() / 1e6,
		UpdatedAt:   0,
		IsStreaming: false,
	}
	if err := db.AddMessage(msg); err != nil {
		log.Fatalf("Failed to add message: %v", err)
	}

	// 4. Export again
	export2, err := db.Export()
	if err != nil {
		log.Fatalf("Failed export 2: %v", err)
	}
	fmt.Printf("Post-insert export size: %d\n", len(export2))

	// 5. Decode and check
	var data map[string]interface{}
	if err := json.Unmarshal(export2, &data); err != nil {
		log.Fatalf("Failed to unmarshal: %v", err)
	}

	threads := data["threads"].([]interface{})
	msgs := data["thread_messages"].([]interface{})
	fmt.Printf("Found %d threads and %d messages\n", len(threads), len(msgs))

	// 6. Test Import
	db2, _ := store.NewSQLiteStore()
	if err := db2.Import(export2); err != nil {
		log.Fatalf("Failed to import: %v", err)
	}

	resThreads, _ := db2.ListThreads("")
	fmt.Printf("ListThreads returned %d threads\n", len(resThreads))
}
