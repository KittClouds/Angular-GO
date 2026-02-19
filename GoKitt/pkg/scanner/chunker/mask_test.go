package chunker

import (
	"testing"
)

func TestIntervalMask_Contains(t *testing.T) {
	mask := NewIntervalMask()
	mask.Add(5, 15, "CHARACTER", "raven")
	mask.Add(20, 30, "LOCATION", "tower")

	tests := []struct {
		pos      int
		expected bool
	}{
		{0, false},
		{4, false},
		{5, true},  // Start of first interval
		{10, true}, // Middle of first interval
		{14, true}, // End-1 of first interval
		{15, false},
		{19, false},
		{20, true}, // Start of second interval
		{25, true}, // Middle of second interval
		{29, true}, // End-1 of second interval
		{30, false},
		{100, false},
	}

	for _, tt := range tests {
		result := mask.Contains(tt.pos)
		if result != tt.expected {
			t.Errorf("Contains(%d) = %v, expected %v", tt.pos, result, tt.expected)
		}
	}
}

func TestIntervalMask_GetInterval(t *testing.T) {
	mask := NewIntervalMask()
	mask.Add(5, 15, "CHARACTER", "raven")
	mask.Add(20, 30, "LOCATION", "tower")

	// Test position inside first interval
	iv := mask.GetInterval(10)
	if iv == nil {
		t.Error("Expected interval at position 10")
	} else {
		if iv.Kind != "CHARACTER" {
			t.Errorf("Expected Kind CHARACTER, got %s", iv.Kind)
		}
		if iv.ID != "raven" {
			t.Errorf("Expected ID raven, got %s", iv.ID)
		}
	}

	// Test position inside second interval
	iv = mask.GetInterval(25)
	if iv == nil {
		t.Error("Expected interval at position 25")
	} else if iv.Kind != "LOCATION" {
		t.Errorf("Expected Kind LOCATION, got %s", iv.Kind)
	}

	// Test position outside any interval
	iv = mask.GetInterval(17)
	if iv != nil {
		t.Errorf("Expected nil at position 17, got %+v", iv)
	}
}

func TestIntervalMask_Overlaps(t *testing.T) {
	mask := NewIntervalMask()
	mask.Add(5, 15, "CHARACTER", "raven")

	tests := []struct {
		start, end int
		expected   bool
	}{
		{0, 5, false},   // Before interval
		{0, 6, true},    // Overlaps start
		{10, 12, true},  // Inside interval
		{14, 20, true},  // Overlaps end
		{15, 20, false}, // After interval
		{0, 4, false},   // Completely before
		{16, 20, false}, // Completely after
	}

	for _, tt := range tests {
		result := mask.Overlaps(tt.start, tt.end)
		if result != tt.expected {
			t.Errorf("Overlaps(%d, %d) = %v, expected %v", tt.start, tt.end, result, tt.expected)
		}
	}
}

func TestIntervalMask_IsEmpty(t *testing.T) {
	mask := NewIntervalMask()
	if !mask.IsEmpty() {
		t.Error("New mask should be empty")
	}

	mask.Add(0, 10, "TEST", "")
	if mask.IsEmpty() {
		t.Error("Mask with interval should not be empty")
	}
}

func TestIntervalMask_Intervals(t *testing.T) {
	mask := NewIntervalMask()
	mask.Add(20, 30, "LOCATION", "tower")
	mask.Add(5, 15, "CHARACTER", "raven") // Added out of order

	intervals := mask.Intervals()

	// Should be sorted by Start
	if len(intervals) != 2 {
		t.Fatalf("Expected 2 intervals, got %d", len(intervals))
	}

	if intervals[0].Start != 5 {
		t.Errorf("First interval should start at 5, got %d", intervals[0].Start)
	}
	if intervals[1].Start != 20 {
		t.Errorf("Second interval should start at 20, got %d", intervals[1].Start)
	}

	// Verify it's a copy (modifying shouldn't affect original)
	intervals[0].Kind = "MODIFIED"
	if mask.intervals[0].Kind == "MODIFIED" {
		t.Error("Intervals() should return a copy")
	}
}
