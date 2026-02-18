package filter

import (
	"testing"
)

// Helper to create metadata map for tests
func makeMeta() map[string]MetaValue {
	return map[string]MetaValue{
		"type":     MetaString("meeting"),
		"year":     MetaNumber(2024.0),
		"priority": MetaNumber(5.0),
		"archived": MetaBool(false),
		"tags":     MetaArray([]string{"rust", "ai"}),
	}
}

// === MetaValue Tests ===

func TestMetaStringAsString(t *testing.T) {
	mv := MetaString("hello")
	s, ok := mv.AsString()
	if !ok {
		t.Error("expected AsString to return true")
	}
	if s != "hello" {
		t.Errorf("expected 'hello', got '%s'", s)
	}
}

func TestMetaStringAsFloat(t *testing.T) {
	mv := MetaString("hello")
	_, ok := mv.AsFloat()
	if ok {
		t.Error("expected AsFloat to return false for string")
	}
}

func TestMetaNumberAsFloat(t *testing.T) {
	mv := MetaNumber(42.5)
	f, ok := mv.AsFloat()
	if !ok {
		t.Error("expected AsFloat to return true")
	}
	if f != 42.5 {
		t.Errorf("expected 42.5, got %f", f)
	}
}

func TestMetaBoolAsBool(t *testing.T) {
	mv := MetaBool(true)
	b, ok := mv.AsBool()
	if !ok {
		t.Error("expected AsBool to return true")
	}
	if !b {
		t.Error("expected true")
	}
}

func TestMetaArrayContains(t *testing.T) {
	mv := MetaArray([]string{"rust", "go", "python"})
	if !mv.Contains("rust") {
		t.Error("expected to contain 'rust'")
	}
	if mv.Contains("java") {
		t.Error("expected not to contain 'java'")
	}
}

func TestMetaStringContains(t *testing.T) {
	mv := MetaString("hello world")
	if !mv.Contains("hello") {
		t.Error("expected to contain 'hello'")
	}
	if mv.Contains("goodbye") {
		t.Error("expected not to contain 'goodbye'")
	}
}

// === Eq Filter Tests ===

func TestEqStringMatch(t *testing.T) {
	meta := makeMeta()
	filter := Eq{Field: "type", Value: MetaString("meeting")}
	if !filter.Matches(meta) {
		t.Error("expected Eq to match")
	}
}

func TestEqStringNoMatch(t *testing.T) {
	meta := makeMeta()
	filter := Eq{Field: "type", Value: MetaString("note")}
	if filter.Matches(meta) {
		t.Error("expected Eq not to match")
	}
}

func TestEqNumberMatch(t *testing.T) {
	meta := makeMeta()
	filter := Eq{Field: "year", Value: MetaNumber(2024.0)}
	if !filter.Matches(meta) {
		t.Error("expected Eq to match number")
	}
}

func TestEqBoolMatch(t *testing.T) {
	meta := makeMeta()
	filter := Eq{Field: "archived", Value: MetaBool(false)}
	if !filter.Matches(meta) {
		t.Error("expected Eq to match bool")
	}
}

func TestEqMissingField(t *testing.T) {
	meta := makeMeta()
	filter := Eq{Field: "nonexistent", Value: MetaString("value")}
	if filter.Matches(meta) {
		t.Error("expected Eq not to match missing field")
	}
}

// === Neq Filter Tests ===

func TestNeqStringMatch(t *testing.T) {
	meta := makeMeta()
	filter := Neq{Field: "type", Value: MetaString("note")}
	if !filter.Matches(meta) {
		t.Error("expected Neq to match (different value)")
	}
}

func TestNeqStringNoMatch(t *testing.T) {
	meta := makeMeta()
	filter := Neq{Field: "type", Value: MetaString("meeting")}
	if filter.Matches(meta) {
		t.Error("expected Neq not to match (same value)")
	}
}

func TestNeqMissingField(t *testing.T) {
	meta := makeMeta()
	filter := Neq{Field: "nonexistent", Value: MetaString("value")}
	if !filter.Matches(meta) {
		t.Error("expected Neq to match missing field (field doesn't exist, so not equal)")
	}
}

// === In Filter Tests ===

func TestInMatch(t *testing.T) {
	meta := makeMeta()
	filter := In{Field: "type", Values: []string{"meeting", "note", "task"}}
	if !filter.Matches(meta) {
		t.Error("expected In to match")
	}
}

func TestInNoMatch(t *testing.T) {
	meta := makeMeta()
	filter := In{Field: "type", Values: []string{"note", "task"}}
	if filter.Matches(meta) {
		t.Error("expected In not to match")
	}
}

func TestInMissingField(t *testing.T) {
	meta := makeMeta()
	filter := In{Field: "nonexistent", Values: []string{"value"}}
	if filter.Matches(meta) {
		t.Error("expected In not to match missing field")
	}
}

// === Range Filter Tests ===

func TestRangeWithinBounds(t *testing.T) {
	meta := makeMeta()
	minVal := 2020.0
	maxVal := 2025.0
	filter := Range{Field: "year", Min: &minVal, Max: &maxVal}
	if !filter.Matches(meta) {
		t.Error("expected Range to match within bounds")
	}
}

func TestRangeBelowMin(t *testing.T) {
	meta := makeMeta()
	minVal := 2025.0
	maxVal := 2030.0
	filter := Range{Field: "year", Min: &minVal, Max: &maxVal}
	if filter.Matches(meta) {
		t.Error("expected Range not to match (below min)")
	}
}

func TestRangeAboveMax(t *testing.T) {
	meta := makeMeta()
	minVal := 2020.0
	maxVal := 2023.0
	filter := Range{Field: "year", Min: &minVal, Max: &maxVal}
	if filter.Matches(meta) {
		t.Error("expected Range not to match (above max)")
	}
}

func TestRangeOnlyMin(t *testing.T) {
	meta := makeMeta()
	minVal := 2020.0
	filter := Range{Field: "year", Min: &minVal, Max: nil}
	if !filter.Matches(meta) {
		t.Error("expected Range to match (only min constraint)")
	}
}

func TestRangeOnlyMax(t *testing.T) {
	meta := makeMeta()
	maxVal := 2025.0
	filter := Range{Field: "year", Min: nil, Max: &maxVal}
	if !filter.Matches(meta) {
		t.Error("expected Range to match (only max constraint)")
	}
}

func TestRangeMissingField(t *testing.T) {
	meta := makeMeta()
	minVal := 2020.0
	maxVal := 2025.0
	filter := Range{Field: "nonexistent", Min: &minVal, Max: &maxVal}
	if filter.Matches(meta) {
		t.Error("expected Range not to match missing field")
	}
}

// === Contains Filter Tests ===

func TestContainsArrayMatch(t *testing.T) {
	meta := makeMeta()
	filter := Contains{Field: "tags", Value: "rust"}
	if !filter.Matches(meta) {
		t.Error("expected Contains to match array element")
	}
}

func TestContainsArrayNoMatch(t *testing.T) {
	meta := makeMeta()
	filter := Contains{Field: "tags", Value: "java"}
	if filter.Matches(meta) {
		t.Error("expected Contains not to match")
	}
}

func TestContainsMissingField(t *testing.T) {
	meta := makeMeta()
	filter := Contains{Field: "nonexistent", Value: "value"}
	if filter.Matches(meta) {
		t.Error("expected Contains not to match missing field")
	}
}

// === And Filter Tests ===

func TestAndAllMatch(t *testing.T) {
	meta := makeMeta()
	filter := And{Conditions: []FilterCondition{
		Eq{Field: "type", Value: MetaString("meeting")},
		Range{Field: "year", Min: ptr(2020.0), Max: nil},
	}}
	if !filter.Matches(meta) {
		t.Error("expected And to match when all conditions match")
	}
}

func TestAndOneFails(t *testing.T) {
	meta := makeMeta()
	filter := And{Conditions: []FilterCondition{
		Eq{Field: "type", Value: MetaString("meeting")},
		Eq{Field: "year", Value: MetaNumber(2020.0)},
	}}
	if filter.Matches(meta) {
		t.Error("expected And not to match when one condition fails")
	}
}

func TestAndEmpty(t *testing.T) {
	meta := makeMeta()
	filter := And{Conditions: []FilterCondition{}}
	if !filter.Matches(meta) {
		t.Error("expected empty And to match (vacuous truth)")
	}
}

// === Or Filter Tests ===

func TestOrOneMatches(t *testing.T) {
	meta := makeMeta()
	filter := Or{Conditions: []FilterCondition{
		Eq{Field: "type", Value: MetaString("note")},
		Eq{Field: "type", Value: MetaString("meeting")},
	}}
	if !filter.Matches(meta) {
		t.Error("expected Or to match when one condition matches")
	}
}

func TestOrNoneMatch(t *testing.T) {
	meta := makeMeta()
	filter := Or{Conditions: []FilterCondition{
		Eq{Field: "type", Value: MetaString("note")},
		Eq{Field: "type", Value: MetaString("task")},
	}}
	if filter.Matches(meta) {
		t.Error("expected Or not to match when no conditions match")
	}
}

func TestOrEmpty(t *testing.T) {
	meta := makeMeta()
	filter := Or{Conditions: []FilterCondition{}}
	if filter.Matches(meta) {
		t.Error("expected empty Or not to match")
	}
}

// === FilterBuilder Tests ===

func TestFilterBuilderEmpty(t *testing.T) {
	filter := NewFilterBuilder().Build()
	if filter != nil {
		t.Error("expected empty builder to return nil")
	}
}

func TestFilterBuilderSingleCondition(t *testing.T) {
	filter := NewFilterBuilder().
		Eq("type", MetaString("meeting")).
		Build()

	if filter == nil {
		t.Fatal("expected non-nil filter")
	}

	// Should be Eq directly, not wrapped in And
	_, isEq := filter.(Eq)
	if !isEq {
		t.Error("expected single condition to be Eq, not wrapped in And")
	}
}

func TestFilterBuilderMultipleConditions(t *testing.T) {
	minVal := 1.0
	maxVal := 10.0
	filter := NewFilterBuilder().
		Eq("type", MetaString("meeting")).
		Range("priority", &minVal, &maxVal).
		Build()

	if filter == nil {
		t.Fatal("expected non-nil filter")
	}

	// Should be wrapped in And
	andFilter, isAnd := filter.(And)
	if !isAnd {
		t.Error("expected multiple conditions to be wrapped in And")
	}
	if len(andFilter.Conditions) != 2 {
		t.Errorf("expected 2 conditions, got %d", len(andFilter.Conditions))
	}
}

func TestFilterBuilderChaining(t *testing.T) {
	filter := NewFilterBuilder().
		Eq("type", MetaString("meeting")).
		Neq("archived", MetaBool(true)).
		In("status", []string{"active", "pending"}).
		Contains("tags", "rust").
		Build()

	if filter == nil {
		t.Fatal("expected non-nil filter")
	}

	andFilter, isAnd := filter.(And)
	if !isAnd {
		t.Error("expected multiple conditions to be wrapped in And")
	}
	if len(andFilter.Conditions) != 4 {
		t.Errorf("expected 4 conditions, got %d", len(andFilter.Conditions))
	}
}

// === Complex Filter Tests ===

func TestNestedAndOr(t *testing.T) {
	meta := makeMeta()

	// (type = meeting AND year >= 2020) OR (type = note)
	filter := Or{Conditions: []FilterCondition{
		And{Conditions: []FilterCondition{
			Eq{Field: "type", Value: MetaString("meeting")},
			Range{Field: "year", Min: ptr(2020.0), Max: nil},
		}},
		Eq{Field: "type", Value: MetaString("note")},
	}}

	if !filter.Matches(meta) {
		t.Error("expected nested filter to match")
	}
}

func TestNestedComplexFilter(t *testing.T) {
	meta := makeMeta()

	// type = meeting AND (priority <= 5 OR tags contains 'ai')
	filter := And{Conditions: []FilterCondition{
		Eq{Field: "type", Value: MetaString("meeting")},
		Or{Conditions: []FilterCondition{
			Range{Field: "priority", Min: nil, Max: ptr(5.0)},
			Contains{Field: "tags", Value: "ai"},
		}},
	}}

	if !filter.Matches(meta) {
		t.Error("expected complex nested filter to match")
	}
}

// Helper function to create float pointer
func ptr(f float64) *float64 {
	return &f
}
