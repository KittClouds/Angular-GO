package main

import (
	"fmt"
	"log"

	"github.com/kittclouds/gokitt/internal/store"
)

func main() {
	fmt.Println("Testing MemStore...")
	testMemStore()

	fmt.Println("\nTesting SQLiteStore...")
	testSQLiteStore()

	fmt.Println("\n✅ All tests passed!")
}

func testMemStore() {
	s := store.NewMemStore()
	defer s.Close()

	// Test Note CRUD
	note := &store.Note{
		ID:        "test-note-1",
		WorldID:   "world-1",
		Title:     "Test Note",
		Content:   "{}",
		CreatedAt: 1234567890,
		UpdatedAt: 1234567890,
	}

	if err := s.UpsertNote(note); err != nil {
		log.Fatalf("UpsertNote failed: %v", err)
	}
	fmt.Println("  ✓ UpsertNote works")

	retrieved, err := s.GetNote("test-note-1")
	if err != nil {
		log.Fatalf("GetNote failed: %v", err)
	}
	if retrieved == nil {
		log.Fatal("GetNote returned nil")
	}
	fmt.Println("  ✓ GetNote works")

	count, err := s.CountNotes()
	if err != nil {
		log.Fatalf("CountNotes failed: %v", err)
	}
	if count != 1 {
		log.Fatalf("CountNotes expected 1, got %d", count)
	}
	fmt.Println("  ✓ CountNotes works")
}

func testSQLiteStore() {
	s, err := store.NewSQLiteStore()
	if err != nil {
		log.Fatalf("NewSQLiteStore failed: %v", err)
	}
	defer s.Close()

	// Test Note CRUD
	note := &store.Note{
		ID:        "test-note-1",
		WorldID:   "world-1",
		Title:     "Test Note",
		Content:   "{}",
		CreatedAt: 1234567890,
		UpdatedAt: 1234567890,
	}

	if err := s.UpsertNote(note); err != nil {
		log.Fatalf("UpsertNote failed: %v", err)
	}
	fmt.Println("  ✓ UpsertNote works")

	retrieved, err := s.GetNote("test-note-1")
	if err != nil {
		log.Fatalf("GetNote failed: %v", err)
	}
	if retrieved == nil {
		log.Fatal("GetNote returned nil")
	}
	fmt.Println("  ✓ GetNote works")

	count, err := s.CountNotes()
	if err != nil {
		log.Fatalf("CountNotes failed: %v", err)
	}
	if count != 1 {
		log.Fatalf("CountNotes expected 1, got %d", count)
	}
	fmt.Println("  ✓ CountNotes works")
}
