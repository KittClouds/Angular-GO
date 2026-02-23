package graptor

import "sync"

// RingBuffer is a fixed-size ring buffer for O(1) append and ordered iteration.
// Used for LastMentioned tracking to avoid O(n) slice operations.
type RingBuffer struct {
	mu   sync.RWMutex
	data []string
	head int // index of oldest element
	size int // current number of elements
	cap  int // maximum capacity
}

// NewRingBuffer creates a new ring buffer with the given capacity.
func NewRingBuffer(capacity int) *RingBuffer {
	if capacity <= 0 {
		capacity = 10 // default
	}
	return &RingBuffer{
		data: make([]string, capacity),
		cap:  capacity,
	}
}

// Push adds an item to the buffer. If the buffer is full, the oldest item is overwritten.
// If the item already exists, it is moved to the most recent position.
// This is O(n) for existence check but O(1) for the actual push.
func (rb *RingBuffer) Push(item string) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	// Check if item already exists
	for i := 0; i < rb.size; i++ {
		idx := (rb.head + i) % rb.cap
		if rb.data[idx] == item {
			// Item exists, remove it and add at end
			rb.removeAt(idx)
			break
		}
	}

	// Add item at the end
	if rb.size < rb.cap {
		// Buffer not full, add at end
		idx := (rb.head + rb.size) % rb.cap
		rb.data[idx] = item
		rb.size++
	} else {
		// Buffer full, overwrite oldest
		rb.data[rb.head] = item
		rb.head = (rb.head + 1) % rb.cap
	}
}

// removeAt removes the item at the given index.
// Must be called with lock held.
func (rb *RingBuffer) removeAt(idx int) {
	if rb.size == 0 {
		return
	}

	// Shift elements to fill the gap
	for i := 0; i < rb.size-1; i++ {
		srcIdx := (idx + i + 1) % rb.cap
		dstIdx := (idx + i) % rb.cap
		rb.data[dstIdx] = rb.data[srcIdx]
	}

	// Clear the last element
	lastIdx := (rb.head + rb.size - 1) % rb.cap
	rb.data[lastIdx] = ""
	rb.size--
}

// ToSlice returns all items in order (most recent first).
func (rb *RingBuffer) ToSlice() []string {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.size == 0 {
		return nil
	}

	result := make([]string, rb.size)
	// Iterate from most recent to oldest
	for i := 0; i < rb.size; i++ {
		// Start from the end and go backwards
		idx := (rb.head + rb.size - 1 - i) % rb.cap
		result[i] = rb.data[idx]
	}
	return result
}

// Len returns the current number of items.
func (rb *RingBuffer) Len() int {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.size
}

// Clear removes all items.
func (rb *RingBuffer) Clear() {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.data = make([]string, rb.cap)
	rb.head = 0
	rb.size = 0
}

// Contains checks if an item is in the buffer.
func (rb *RingBuffer) Contains(item string) bool {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	for i := 0; i < rb.size; i++ {
		idx := (rb.head + i) % rb.cap
		if rb.data[idx] == item {
			return true
		}
	}
	return false
}

// GetMostRecent returns the most recently added item.
func (rb *RingBuffer) GetMostRecent() string {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.size == 0 {
		return ""
	}

	idx := (rb.head + rb.size - 1) % rb.cap
	return rb.data[idx]
}

// GetLeastRecent returns the oldest item.
func (rb *RingBuffer) GetLeastRecent() string {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.size == 0 {
		return ""
	}

	return rb.data[rb.head]
}
