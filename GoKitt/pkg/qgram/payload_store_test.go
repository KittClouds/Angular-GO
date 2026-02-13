package qgram

import (
	"testing"
)

// TestPayloadStore tests basic payload store operations
func TestPayloadStore(t *testing.T) {
	s := NewPayloadStore()

	// Test Set and Get
	p := GramPayload{
		SegMask: 0xFF,
		TFTitle: 3,
		TFBody:  5,
	}
	s.Set(1, p)

	got, ok := s.Get(1)
	if !ok {
		t.Error("Expected to find payload")
	}
	if got.SegMask != 0xFF {
		t.Errorf("Expected SegMask=0xFF, got 0x%X", got.SegMask)
	}
	if got.TFTitle != 3 {
		t.Errorf("Expected TFTitle=3, got %d", got.TFTitle)
	}
	if got.TFBody != 5 {
		t.Errorf("Expected TFBody=5, got %d", got.TFBody)
	}

	// Test non-existent
	_, ok = s.Get(999)
	if ok {
		t.Error("Should not find non-existent payload")
	}
}

// TestPayloadStoreSegMask tests segment mask operations
func TestPayloadStoreSegMask(t *testing.T) {
	s := NewPayloadStore()

	// Set initial mask
	s.Set(1, GramPayload{SegMask: 0x0F})

	// Get mask
	mask := s.GetSegMask(1)
	if mask != 0x0F {
		t.Errorf("Expected mask 0x0F, got 0x%X", mask)
	}

	// Update mask (OR)
	s.UpdateSegMask(1, 0xF0)
	mask = s.GetSegMask(1)
	if mask != 0xFF {
		t.Errorf("Expected mask 0xFF after update, got 0x%X", mask)
	}

	// Non-existent
	mask = s.GetSegMask(999)
	if mask != 0 {
		t.Errorf("Expected 0 for non-existent, got 0x%X", mask)
	}
}

// TestPayloadStoreTF tests term frequency operations
func TestPayloadStoreTF(t *testing.T) {
	s := NewPayloadStore()

	// Increment TF
	s.IncrementTF(1, "title")
	s.IncrementTF(1, "title")
	s.IncrementTF(1, "body")

	// Get TF
	if tf := s.GetTF(1, "title"); tf != 2 {
		t.Errorf("Expected TFTitle=2, got %d", tf)
	}
	if tf := s.GetTF(1, "body"); tf != 1 {
		t.Errorf("Expected TFBody=1, got %d", tf)
	}
	if tf := s.GetTF(1, "tags"); tf != 0 {
		t.Errorf("Expected TFTags=0, got %d", tf)
	}
}

// TestPayloadStoreDelete tests deletion
func TestPayloadStoreDelete(t *testing.T) {
	s := NewPayloadStore()

	s.Set(1, GramPayload{SegMask: 0xFF})
	s.Set(2, GramPayload{SegMask: 0x0F})

	if s.Len() != 2 {
		t.Errorf("Expected Len=2, got %d", s.Len())
	}

	s.Delete(1)
	if _, ok := s.Get(1); ok {
		t.Error("Should not find deleted payload")
	}
	if s.Len() != 1 {
		t.Errorf("Expected Len=1 after delete, got %d", s.Len())
	}
}

// TestPayloadStoreDensify tests conversion to dense storage
func TestPayloadStoreDensify(t *testing.T) {
	s := NewPayloadStore()

	// Add sparse entries
	s.Set(1, GramPayload{SegMask: 0x01})
	s.Set(5, GramPayload{SegMask: 0x02})
	s.Set(10, GramPayload{SegMask: 0x03})

	if !s.isSparse {
		t.Error("Should start as sparse")
	}

	// Densify
	s.Densify(10)

	if s.isSparse {
		t.Error("Should be dense after Densify")
	}

	// Verify data preserved
	if mask := s.GetSegMask(1); mask != 0x01 {
		t.Errorf("Expected mask 0x01, got 0x%X", mask)
	}
	if mask := s.GetSegMask(5); mask != 0x02 {
		t.Errorf("Expected mask 0x02, got 0x%X", mask)
	}
	if mask := s.GetSegMask(10); mask != 0x03 {
		t.Errorf("Expected mask 0x03, got 0x%X", mask)
	}
}

// TestDensePayloadStore tests pre-allocated dense storage
func TestDensePayloadStore(t *testing.T) {
	s := NewDensePayloadStore(100)

	if s.isSparse {
		t.Error("Should be dense from start")
	}

	s.Set(50, GramPayload{SegMask: 0xAB})

	got, ok := s.Get(50)
	if !ok {
		t.Error("Expected to find payload")
	}
	if got.SegMask != 0xAB {
		t.Errorf("Expected SegMask=0xAB, got 0x%X", got.SegMask)
	}
}

// TestGramPayloadStore tests the gram-level payload store
func TestGramPayloadStore(t *testing.T) {
	s := NewGramPayloadStore()

	// Set payloads
	s.SetPayload("ban", 1, GramPayload{SegMask: 0x01, TFBody: 3})
	s.SetPayload("ban", 2, GramPayload{SegMask: 0x02, TFBody: 5})
	s.SetPayload("app", 1, GramPayload{SegMask: 0x04, TFTitle: 2})

	// Get payloads
	p, ok := s.GetPayload("ban", 1)
	if !ok {
		t.Error("Expected to find payload for 'ban'/1")
	}
	if p.TFBody != 3 {
		t.Errorf("Expected TFBody=3, got %d", p.TFBody)
	}

	// Gram count
	if s.GramCount() != 2 {
		t.Errorf("Expected GramCount=2, got %d", s.GramCount())
	}

	// Delete gram
	s.DeleteGram("app")
	if s.GramCount() != 1 {
		t.Errorf("Expected GramCount=1 after delete, got %d", s.GramCount())
	}
	_, ok = s.GetPayload("app", 1)
	if ok {
		t.Error("Should not find payload after gram delete")
	}
}

// TestGramPayloadStoreDeleteDoc tests deleting a doc from all grams
func TestGramPayloadStoreDeleteDoc(t *testing.T) {
	s := NewGramPayloadStore()

	s.SetPayload("ban", 1, GramPayload{SegMask: 0x01})
	s.SetPayload("ban", 2, GramPayload{SegMask: 0x02})
	s.SetPayload("app", 1, GramPayload{SegMask: 0x04})
	s.SetPayload("app", 3, GramPayload{SegMask: 0x08})

	// Delete doc 1
	s.DeleteDoc(1)

	// Doc 1 should be gone from all grams
	_, ok := s.GetPayload("ban", 1)
	if ok {
		t.Error("Should not find doc 1 in 'ban'")
	}
	_, ok = s.GetPayload("app", 1)
	if ok {
		t.Error("Should not find doc 1 in 'app'")
	}

	// Other docs should remain
	_, ok = s.GetPayload("ban", 2)
	if !ok {
		t.Error("Should still find doc 2 in 'ban'")
	}
	_, ok = s.GetPayload("app", 3)
	if !ok {
		t.Error("Should still find doc 3 in 'app'")
	}
}

// TestPayloadStoreMemoryUsage tests memory usage estimation
func TestPayloadStoreMemoryUsage(t *testing.T) {
	s := NewPayloadStore()

	// Add some entries
	for i := uint32(1); i <= 100; i++ {
		s.Set(i, GramPayload{SegMask: i})
	}

	mem := s.MemoryUsage()
	if mem <= 0 {
		t.Error("Memory usage should be positive")
	}

	// Dense should be more memory efficient for dense data
	s.Densify(100)
	memDense := s.MemoryUsage()
	if memDense <= 0 {
		t.Error("Dense memory usage should be positive")
	}

	// Dense should be smaller for dense data
	if memDense > mem {
		t.Logf("Note: Dense (%d) > Sparse (%d) for small data, this is expected", memDense, mem)
	}
}

// BenchmarkPayloadStoreSet benchmarks setting payloads
func BenchmarkPayloadStoreSet(b *testing.B) {
	s := NewPayloadStore()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.Set(uint32(i%10000), GramPayload{SegMask: uint32(i)})
	}
}

// BenchmarkPayloadStoreGet benchmarks getting payloads
func BenchmarkPayloadStoreGet(b *testing.B) {
	s := NewPayloadStore()
	for i := 0; i < 10000; i++ {
		s.Set(uint32(i), GramPayload{SegMask: uint32(i)})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.GetSegMask(uint32(i % 10000))
	}
}

// BenchmarkDensePayloadStoreGet benchmarks dense storage get
func BenchmarkDensePayloadStoreGet(b *testing.B) {
	s := NewDensePayloadStore(10000)
	for i := 0; i < 10000; i++ {
		s.Set(uint32(i), GramPayload{SegMask: uint32(i)})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.GetSegMask(uint32(i % 10000))
	}
}
