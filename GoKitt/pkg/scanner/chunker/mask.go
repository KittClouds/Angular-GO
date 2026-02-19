// Package chunker implements rule-based phrase chunking for NP/VP/PP detection.
package chunker

import "sort"

// Interval represents a locked entity span that cannot be split during chunking.
type Interval struct {
	Start int    // Byte offset start (inclusive)
	End   int    // Byte offset end (exclusive)
	Kind  string // Entity kind (e.g., "CHARACTER", "LOCATION")
	ID    string // Entity ID if known, empty otherwise
}

// IntervalMask tracks locked entity spans for NER-native chunking.
// Intervals are kept sorted by Start position for efficient binary search.
type IntervalMask struct {
	intervals []Interval
}

// NewIntervalMask creates an empty mask.
func NewIntervalMask() *IntervalMask {
	return &IntervalMask{
		intervals: make([]Interval, 0),
	}
}

// Add inserts a new locked interval into the mask.
// Intervals are kept sorted by Start position.
func (m *IntervalMask) Add(start, end int, kind, id string) {
	m.intervals = append(m.intervals, Interval{
		Start: start,
		End:   end,
		Kind:  kind,
		ID:    id,
	})
	// Keep sorted by Start
	sort.Slice(m.intervals, func(i, j int) bool {
		return m.intervals[i].Start < m.intervals[j].Start
	})
}

// Contains checks if position pos falls within any locked interval.
// Uses binary search for O(log n) lookup.
func (m *IntervalMask) Contains(pos int) bool {
	return m.GetInterval(pos) != nil
}

// GetInterval returns the interval containing position pos, or nil if none.
// Uses binary search to find the candidate interval efficiently.
func (m *IntervalMask) GetInterval(pos int) *Interval {
	if len(m.intervals) == 0 {
		return nil
	}

	// Binary search: find the rightmost interval with Start <= pos
	lo, hi := 0, len(m.intervals)
	for lo < hi {
		mid := (lo + hi) / 2
		if m.intervals[mid].Start <= pos {
			lo = mid + 1
		} else {
			hi = mid
		}
	}

	// lo is now the index of the first interval with Start > pos
	// Check the interval before it (if exists)
	if lo == 0 {
		return nil // All intervals start after pos
	}

	candidate := &m.intervals[lo-1]
	if pos >= candidate.Start && pos < candidate.End {
		return candidate
	}
	return nil
}

// Overlaps checks if the range [start, end) overlaps with any locked interval.
func (m *IntervalMask) Overlaps(start, end int) bool {
	for _, iv := range m.intervals {
		if start < iv.End && iv.Start < end {
			return true
		}
	}
	return false
}

// Intervals returns a copy of all intervals (for debugging/visualization).
func (m *IntervalMask) Intervals() []Interval {
	result := make([]Interval, len(m.intervals))
	copy(result, m.intervals)
	return result
}

// IsEmpty returns true if mask has no intervals.
func (m *IntervalMask) IsEmpty() bool {
	return len(m.intervals) == 0
}
