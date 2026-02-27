package gldr

import (
	"fmt"
)

// TemporalSource defines the type of temporal marker.
type TemporalSource string

const (
	TemporalSourceChapter  TemporalSource = "chapter"  // Narrative chapter (1-indexed)
	TemporalSourceCalendar TemporalSource = "calendar" // Unix milliseconds
	TemporalSourceStory    TemporalSource = "story"    // Custom story time (lexicographic)
	TemporalSourceOrdinal  TemporalSource = "ordinal"  // User-defined sequence
)

// TemporalMarker represents a point in time using multiple time systems.
// Only one field should be set at a time, indicated by Source.
type TemporalMarker struct {
	// Narrative chapter (1-indexed)
	Chapter *uint32 `json:"chapter,omitempty"`

	// Calendar time (Unix milliseconds)
	Calendar *int64 `json:"calendar,omitempty"`

	// Story time (custom string, compared lexicographically)
	StoryTime *string `json:"storyTime,omitempty"`

	// Custom ordinal (user-defined sequence)
	Ordinal *int64 `json:"ordinal,omitempty"`

	// Source indicates which field is active
	Source TemporalSource `json:"source"`
}

// NewChapterMarker creates a temporal marker for a narrative chapter.
func NewChapterMarker(chapter uint32) *TemporalMarker {
	return &TemporalMarker{
		Chapter: &chapter,
		Source:  TemporalSourceChapter,
	}
}

// NewCalendarMarker creates a temporal marker for a calendar time (Unix milliseconds).
func NewCalendarMarker(millis int64) *TemporalMarker {
	return &TemporalMarker{
		Calendar: &millis,
		Source:   TemporalSourceCalendar,
	}
}

// NewStoryMarker creates a temporal marker for story time (lexicographic comparison).
func NewStoryMarker(storyTime string) *TemporalMarker {
	return &TemporalMarker{
		StoryTime: &storyTime,
		Source:    TemporalSourceStory,
	}
}

// NewOrdinalMarker creates a temporal marker for a user-defined ordinal.
func NewOrdinalMarker(ordinal int64) *TemporalMarker {
	return &TemporalMarker{
		Ordinal: &ordinal,
		Source:  TemporalSourceOrdinal,
	}
}

// IsZero returns true if no temporal marker is set.
func (tm *TemporalMarker) IsZero() bool {
	return tm.Source == "" ||
		(tm.Chapter == nil && tm.Calendar == nil &&
			tm.StoryTime == nil && tm.Ordinal == nil)
}

// Compare returns -1, 0, or 1 based on temporal ordering.
// Returns error if markers use different sources.
// Story time is compared lexicographically.
func (tm *TemporalMarker) Compare(other *TemporalMarker) (int, error) {
	if tm.Source != other.Source {
		return 0, fmt.Errorf("cannot compare different temporal sources: %s vs %s", tm.Source, other.Source)
	}

	switch tm.Source {
	case TemporalSourceChapter:
		return compareUint32(tm.Chapter, other.Chapter), nil
	case TemporalSourceCalendar:
		return compareInt64(tm.Calendar, other.Calendar), nil
	case TemporalSourceOrdinal:
		return compareInt64(tm.Ordinal, other.Ordinal), nil
	case TemporalSourceStory:
		return compareString(tm.StoryTime, other.StoryTime), nil
	default:
		return 0, fmt.Errorf("unknown temporal source: %s", tm.Source)
	}
}

// Equal returns true if both markers represent the same time.
func (tm *TemporalMarker) Equal(other *TemporalMarker) bool {
	if tm.Source != other.Source {
		return false
	}
	cmp, err := tm.Compare(other)
	if err != nil {
		return false
	}
	return cmp == 0
}

// Before returns true if tm is strictly before other.
func (tm *TemporalMarker) Before(other *TemporalMarker) (bool, error) {
	cmp, err := tm.Compare(other)
	if err != nil {
		return false, err
	}
	return cmp < 0, nil
}

// After returns true if tm is strictly after other.
func (tm *TemporalMarker) After(other *TemporalMarker) (bool, error) {
	cmp, err := tm.Compare(other)
	if err != nil {
		return false, err
	}
	return cmp > 0, nil
}

// TemporalRange defines a time range for filtering.
type TemporalRange struct {
	Start *TemporalMarker `json:"start,omitempty"`
	End   *TemporalMarker `json:"end,omitempty"`

	// Inclusive flags (default: true for both)
	StartInclusive bool `json:"startInclusive"`
	EndInclusive   bool `json:"endInclusive"`
}

// NewTemporalRange creates a new temporal range with inclusive bounds.
func NewTemporalRange(start, end *TemporalMarker) *TemporalRange {
	return &TemporalRange{
		Start:          start,
		End:            end,
		StartInclusive: true,
		EndInclusive:   true,
	}
}

// Contains checks if a marker falls within the range.
func (tr *TemporalRange) Contains(marker *TemporalMarker) (bool, error) {
	// Check start bound
	if tr.Start != nil && !tr.Start.IsZero() {
		cmp, err := tr.Start.Compare(marker)
		if err != nil {
			return false, err
		}
		if tr.StartInclusive && cmp > 0 {
			return false, nil
		}
		if !tr.StartInclusive && cmp >= 0 {
			return false, nil
		}
	}

	// Check end bound
	if tr.End != nil && !tr.End.IsZero() {
		cmp, err := tr.End.Compare(marker)
		if err != nil {
			return false, err
		}
		if tr.EndInclusive && cmp < 0 {
			return false, nil
		}
		if !tr.EndInclusive && cmp <= 0 {
			return false, nil
		}
	}

	return true, nil
}

// IsZero returns true if the range has no bounds.
func (tr *TemporalRange) IsZero() bool {
	return (tr.Start == nil || tr.Start.IsZero()) &&
		(tr.End == nil || tr.End.IsZero())
}

// TemporalQueryOptions controls time-based filtering.
type TemporalQueryOptions struct {
	// AsOf returns the graph state at a specific point in time
	AsOf *TemporalMarker `json:"asOf,omitempty"`

	// During returns edges valid during a time range
	During *TemporalRange `json:"during,omitempty"`

	// IncludeTimeless includes edges without temporal markers (default: true)
	IncludeTimeless bool `json:"includeTimeless"`

	// TemporalMode controls how temporal edges are handled
	// "strict" = only edges valid at AsOf
	// "snapshot" = graph state as of AsOf (includes timeless)
	// "full" = ignore temporal markers
	TemporalMode string `json:"temporalMode"`

	// AllowedRelations restricts the query to specific edge types. If empty, all are allowed.
	AllowedRelations []string `json:"allowedRelations,omitempty"`
}

// DefaultTemporalQueryOptions returns default options (include timeless, snapshot mode).
func DefaultTemporalQueryOptions() *TemporalQueryOptions {
	return &TemporalQueryOptions{
		IncludeTimeless: true,
		TemporalMode:    "snapshot",
	}
}

// AsOfSnapshot creates options for a snapshot query at a specific time.
func AsOfSnapshot(marker *TemporalMarker) *TemporalQueryOptions {
	return &TemporalQueryOptions{
		AsOf:            marker,
		IncludeTimeless: true,
		TemporalMode:    "snapshot",
	}
}

// DuringRange creates options for a range query.
func DuringRange(start, end *TemporalMarker) *TemporalQueryOptions {
	return &TemporalQueryOptions{
		During:          NewTemporalRange(start, end),
		IncludeTimeless: false,
		TemporalMode:    "strict",
	}
}

// --- Helper functions ---

func compareUint32(a, b *uint32) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if *a < *b {
		return -1
	}
	if *a > *b {
		return 1
	}
	return 0
}

func compareInt64(a, b *int64) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if *a < *b {
		return -1
	}
	if *a > *b {
		return 1
	}
	return 0
}

func compareString(a, b *string) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return -1
	}
	if b == nil {
		return 1
	}
	if *a < *b {
		return -1
	}
	if *a > *b {
		return 1
	}
	return 0
}
