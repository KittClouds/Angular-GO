package graptor

import "sync"

// StringInterner provides string interning to reduce memory duplication.
// Common strings (like entity IDs) are stored once and reused.
type StringInterner struct {
	mu   sync.RWMutex
	pool map[string]string // interned string -> interned string
	hits int64             // number of cache hits
	miss int64             // number of cache misses
}

// NewStringInterner creates a new string interner.
func NewStringInterner(expectedSize int) *StringInterner {
	if expectedSize <= 0 {
		expectedSize = 256
	}
	return &StringInterner{
		pool: make(map[string]string, expectedSize),
	}
}

// Intern returns an interned copy of the string.
// If the string has been seen before, the existing copy is returned.
// This reduces memory usage when the same string is stored multiple times.
func (si *StringInterner) Intern(s string) string {
	if s == "" {
		return ""
	}

	// Check if already interned
	si.mu.RLock()
	if interned, ok := si.pool[s]; ok {
		si.mu.RUnlock()
		si.mu.Lock()
		si.hits++
		si.mu.Unlock()
		return interned
	}
	si.mu.RUnlock()

	// Not found, add to pool
	si.mu.Lock()
	defer si.mu.Unlock()

	// Double-check after acquiring write lock
	if interned, ok := si.pool[s]; ok {
		si.hits++
		return interned
	}

	// Add new entry
	si.pool[s] = s
	si.miss++
	return s
}

// Stats returns interner statistics.
func (si *StringInterner) Stats() (entries int, hits, misses int64) {
	si.mu.RLock()
	defer si.mu.RUnlock()
	return len(si.pool), si.hits, si.miss
}

// Size returns the number of interned strings.
func (si *StringInterner) Size() int {
	si.mu.RLock()
	defer si.mu.RUnlock()
	return len(si.pool)
}

// Clear removes all interned strings.
func (si *StringInterner) Clear() {
	si.mu.Lock()
	defer si.mu.Unlock()
	si.pool = make(map[string]string)
	si.hits = 0
	si.miss = 0
}

// Global string interner for entity IDs
var globalInterner = NewStringInterner(1024)

// InternID interns an entity ID string.
// This is a convenience function using the global interner.
func InternID(id string) string {
	return globalInterner.Intern(id)
}

// GetInternerStats returns statistics for the global interner.
func GetInternerStats() (entries int, hits, misses int64) {
	return globalInterner.Stats()
}
