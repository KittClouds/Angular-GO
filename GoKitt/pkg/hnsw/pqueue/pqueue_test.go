// Package pqueue provides priority queue implementations for HNSW search
package pqueue

import (
	"container/heap"
	"math"
	"testing"
)

// ============================================================================
// MaxHeap Contract Tests
// ============================================================================

func TestMaxHeap_Basic(t *testing.T) {
	h := &MaxHeap{}
	heap.Push(h, ScoredItem{Score: 0.5, ID: 1})
	heap.Push(h, ScoredItem{Score: 0.9, ID: 2})
	heap.Push(h, ScoredItem{Score: 0.3, ID: 3})

	// Pop returns highest score first
	top := heap.Pop(h).(ScoredItem)
	if top.ID != 2 {
		t.Errorf("MaxHeap.Pop() = ID %v, want 2 (highest score)", top.ID)
	}
	if math.Abs(float64(top.Score-0.9)) > 1e-6 {
		t.Errorf("MaxHeap.Pop() = score %v, want 0.9", top.Score)
	}
}

func TestMaxHeap_Peek(t *testing.T) {
	h := &MaxHeap{}

	// Empty heap
	if _, ok := h.Peek(); ok {
		t.Error("Peek on empty heap should return false")
	}

	heap.Push(h, ScoredItem{Score: 0.5, ID: 1})
	heap.Push(h, ScoredItem{Score: 0.9, ID: 2})

	// Peek should return highest without removing
	top, ok := h.Peek()
	if !ok {
		t.Error("Peek should return true")
	}
	if top.ID != 2 {
		t.Errorf("Peek() = ID %v, want 2", top.ID)
	}
	if h.Len() != 2 {
		t.Errorf("Peek should not remove item, len = %v, want 2", h.Len())
	}
}

func TestMaxHeap_PushPopItem(t *testing.T) {
	h := &MaxHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.9)
	h.PushItem(3, 0.3)

	item, ok := h.PopItem()
	if !ok {
		t.Error("PopItem should return true")
	}
	if item.ID != 2 {
		t.Errorf("PopItem() = ID %v, want 2", item.ID)
	}
}

func TestMaxHeap_Empty(t *testing.T) {
	h := &MaxHeap{}

	if _, ok := h.PopItem(); ok {
		t.Error("PopItem on empty heap should return false")
	}
}

func TestMaxHeap_Ordering(t *testing.T) {
	h := &MaxHeap{}
	scores := []float32{0.1, 0.9, 0.5, 0.3, 0.7}

	for i, score := range scores {
		h.PushItem(uint32(i), score)
	}

	// Should pop in descending order
	prev := float32(1.1) // Higher than max
	for h.Len() > 0 {
		item, _ := h.PopItem()
		if item.Score > prev {
			t.Errorf("MaxHeap ordering broken: %v > %v", item.Score, prev)
		}
		prev = item.Score
	}
}

// ============================================================================
// MinHeap Contract Tests
// ============================================================================

func TestMinHeap_Basic(t *testing.T) {
	h := &MinHeap{}
	heap.Push(h, ScoredItem{Score: 0.5, ID: 1})
	heap.Push(h, ScoredItem{Score: 0.9, ID: 2})
	heap.Push(h, ScoredItem{Score: 0.3, ID: 3})

	// Pop returns lowest score first
	top := heap.Pop(h).(ScoredItem)
	if top.ID != 3 {
		t.Errorf("MinHeap.Pop() = ID %v, want 3 (lowest score)", top.ID)
	}
	if math.Abs(float64(top.Score-0.3)) > 1e-6 {
		t.Errorf("MinHeap.Pop() = score %v, want 0.3", top.Score)
	}
}

func TestMinHeap_Peek(t *testing.T) {
	h := &MinHeap{}

	// Empty heap
	if _, ok := h.Peek(); ok {
		t.Error("Peek on empty heap should return false")
	}

	heap.Push(h, ScoredItem{Score: 0.5, ID: 1})
	heap.Push(h, ScoredItem{Score: 0.3, ID: 2})

	// Peek should return lowest without removing
	top, ok := h.Peek()
	if !ok {
		t.Error("Peek should return true")
	}
	if top.ID != 2 {
		t.Errorf("Peek() = ID %v, want 2", top.ID)
	}
	if h.Len() != 2 {
		t.Errorf("Peek should not remove item, len = %v, want 2", h.Len())
	}
}

func TestMinHeap_WorstScore(t *testing.T) {
	h := &MinHeap{}

	// Empty heap returns negative infinity
	if !math.IsInf(float64(h.WorstScore()), -1) {
		t.Errorf("WorstScore on empty heap should be -Inf, got %v", h.WorstScore())
	}

	h.PushItem(1, 0.5)
	h.PushItem(2, 0.3)
	h.PushItem(3, 0.9)

	// Worst score should be lowest (0.3)
	if math.Abs(float64(h.WorstScore())-0.3) > 1e-6 {
		t.Errorf("WorstScore() = %v, want 0.3", h.WorstScore())
	}
}

func TestMinHeap_Ordering(t *testing.T) {
	h := &MinHeap{}
	scores := []float32{0.1, 0.9, 0.5, 0.3, 0.7}

	for i, score := range scores {
		h.PushItem(uint32(i), score)
	}

	// Should pop in ascending order
	prev := float32(-0.1) // Lower than min
	for h.Len() > 0 {
		item, _ := h.PopItem()
		if item.Score < prev {
			t.Errorf("MinHeap ordering broken: %v < %v", item.Score, prev)
		}
		prev = item.Score
	}
}

// ============================================================================
// SortedDesc Tests
// ============================================================================

func TestMaxHeap_SortedDesc(t *testing.T) {
	h := &MaxHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.9)
	h.PushItem(3, 0.3)

	sorted := h.SortedDesc()

	// Should be in descending order
	if sorted[0].ID != 2 || sorted[1].ID != 1 || sorted[2].ID != 3 {
		t.Errorf("SortedDesc() = %v, want IDs [2, 1, 3] in descending score order", sorted)
	}
}

func TestMinHeap_SortedDesc(t *testing.T) {
	h := &MinHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.9)
	h.PushItem(3, 0.3)

	sorted := h.SortedDesc()

	// Should be in descending order
	if len(sorted) != 3 {
		t.Errorf("SortedDesc() length = %v, want 3", len(sorted))
		return
	}

	// First should be highest score (ID 2, score 0.9)
	if sorted[0].ID != 2 {
		t.Errorf("SortedDesc()[0] = ID %v, want 2", sorted[0].ID)
	}

	// Last should be lowest score (ID 3, score 0.3)
	if sorted[2].ID != 3 {
		t.Errorf("SortedDesc()[2] = ID %v, want 3", sorted[2].ID)
	}
}

// ============================================================================
// ToSlice Tests
// ============================================================================

func TestMaxHeap_ToSlice(t *testing.T) {
	h := &MaxHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.9)

	slice := h.ToSlice()
	if len(slice) != 2 {
		t.Errorf("ToSlice() length = %v, want 2", len(slice))
	}
}

func TestMinHeap_ToSlice(t *testing.T) {
	h := &MinHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.9)

	slice := h.ToSlice()
	if len(slice) != 2 {
		t.Errorf("ToSlice() length = %v, want 2", len(slice))
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestMaxHeap_SingleItem(t *testing.T) {
	h := &MaxHeap{}
	h.PushItem(42, 0.5)

	item, ok := h.PopItem()
	if !ok || item.ID != 42 {
		t.Errorf("Single item pop failed: %+v", item)
	}
}

func TestMinHeap_SingleItem(t *testing.T) {
	h := &MinHeap{}
	h.PushItem(42, 0.5)

	item, ok := h.PopItem()
	if !ok || item.ID != 42 {
		t.Errorf("Single item pop failed: %+v", item)
	}
}

func TestMaxHeap_DuplicateScores(t *testing.T) {
	h := &MaxHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.5)
	h.PushItem(3, 0.5)

	// All should be popped
	count := 0
	for h.Len() > 0 {
		h.PopItem()
		count++
	}
	if count != 3 {
		t.Errorf("Duplicate scores: popped %v items, want 3", count)
	}
}

func TestMinHeap_DuplicateScores(t *testing.T) {
	h := &MinHeap{}
	h.PushItem(1, 0.5)
	h.PushItem(2, 0.5)
	h.PushItem(3, 0.5)

	// All should be popped
	count := 0
	for h.Len() > 0 {
		h.PopItem()
		count++
	}
	if count != 3 {
		t.Errorf("Duplicate scores: popped %v items, want 3", count)
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkMaxHeap_Push(b *testing.B) {
	h := &MaxHeap{}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.PushItem(uint32(i), float32(i%100)/100.0)
	}
}

func BenchmarkMaxHeap_Pop(b *testing.B) {
	h := &MaxHeap{}
	for i := 0; i < b.N; i++ {
		h.PushItem(uint32(i), float32(i%100)/100.0)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.PopItem()
	}
}

func BenchmarkMinHeap_Push(b *testing.B) {
	h := &MinHeap{}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.PushItem(uint32(i), float32(i%100)/100.0)
	}
}

func BenchmarkMinHeap_Pop(b *testing.B) {
	h := &MinHeap{}
	for i := 0; i < b.N; i++ {
		h.PushItem(uint32(i), float32(i%100)/100.0)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.PopItem()
	}
}
