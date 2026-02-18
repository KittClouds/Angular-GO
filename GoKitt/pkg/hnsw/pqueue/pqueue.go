// Package pqueue provides priority queue implementations for HNSW search
// Ported from Rust HNSW implementation
package pqueue

import (
	"container/heap"
	"math"
)

// ScoredItem is an item with a score for priority queue ordering
// Equivalent to Rust: ScoredItem<T> { score: f32, item: T }
type ScoredItem struct {
	Score float32
	ID    uint32
}

// MaxHeap implements a max-heap by score (highest score first)
// Used for candidate exploration in HNSW search
type MaxHeap []ScoredItem

// Implement heap.Interface for MaxHeap

func (h MaxHeap) Len() int           { return len(h) }
func (h MaxHeap) Less(i, j int) bool { return h[i].Score > h[j].Score } // Higher score = higher priority
func (h MaxHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *MaxHeap) Push(x interface{}) {
	*h = append(*h, x.(ScoredItem))
}

func (h *MaxHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[0 : n-1]
	return item
}

// Peek returns the top item without removing it
func (h MaxHeap) Peek() (ScoredItem, bool) {
	if len(h) == 0 {
		return ScoredItem{}, false
	}
	return h[0], true
}

// PushItem is a convenience method
func (h *MaxHeap) PushItem(id uint32, score float32) {
	heap.Push(h, ScoredItem{ID: id, Score: score})
}

// PopItem is a convenience method
func (h *MaxHeap) PopItem() (ScoredItem, bool) {
	if h.Len() == 0 {
		return ScoredItem{}, false
	}
	return heap.Pop(h).(ScoredItem), true
}

// MinHeap implements a min-heap by score (lowest score first)
// Used for keeping top-k results (worst at top for easy eviction)
type MinHeap []ScoredItem

// Implement heap.Interface for MinHeap

func (h MinHeap) Len() int           { return len(h) }
func (h MinHeap) Less(i, j int) bool { return h[i].Score < h[j].Score } // Lower score = higher priority (for eviction)
func (h MinHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *MinHeap) Push(x interface{}) {
	*h = append(*h, x.(ScoredItem))
}

func (h *MinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[0 : n-1]
	return item
}

// Peek returns the top item (lowest score) without removing it
func (h MinHeap) Peek() (ScoredItem, bool) {
	if len(h) == 0 {
		return ScoredItem{}, false
	}
	return h[0], true
}

// PushItem is a convenience method
func (h *MinHeap) PushItem(id uint32, score float32) {
	heap.Push(h, ScoredItem{ID: id, Score: score})
}

// PopItem is a convenience method
func (h *MinHeap) PopItem() (ScoredItem, bool) {
	if h.Len() == 0 {
		return ScoredItem{}, false
	}
	return heap.Pop(h).(ScoredItem), true
}

// WorstScore returns the worst (lowest) score in the heap, or negative infinity if empty
func (h MinHeap) WorstScore() float32 {
	if len(h) == 0 {
		return float32(math.Inf(-1)) // Negative infinity
	}
	return h[0].Score
}

// ToSlice returns all items as a slice (order not guaranteed)
func (h MinHeap) ToSlice() []ScoredItem {
	return []ScoredItem(h)
}

// ToSlice returns all items as a slice (order not guaranteed)
func (h MaxHeap) ToSlice() []ScoredItem {
	return []ScoredItem(h)
}

// SortedDesc returns items sorted by score descending
func (h MaxHeap) SortedDesc() []ScoredItem {
	result := make([]ScoredItem, len(h))
	copy(result, h)
	// Sort descending by score
	for i := 0; i < len(result); i++ {
		for j := i + 1; j < len(result); j++ {
			if result[j].Score > result[i].Score {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}

// SortedDesc returns items sorted by score descending (extracts from min-heap)
func (h MinHeap) SortedDesc() []ScoredItem {
	n := len(h)

	// Copy heap to avoid modifying original
	temp := make(MinHeap, n)
	copy(temp, h)

	// Pop all items (will come out in ascending order)
	sorted := make([]ScoredItem, 0, n)
	for temp.Len() > 0 {
		item := heap.Pop(&temp).(ScoredItem)
		sorted = append(sorted, item)
	}

	// Reverse to get descending order
	for i := 0; i < n/2; i++ {
		sorted[i], sorted[n-1-i] = sorted[n-1-i], sorted[i]
	}

	return sorted
}
