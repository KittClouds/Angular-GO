// Package filter provides metadata filtering for HNSW search
package filter

import "strings"

// MetaValue represents a metadata value that can be one of several types
type MetaValue interface {
	AsString() (string, bool)
	AsFloat() (float64, bool)
	AsBool() (bool, bool)
	Contains(value string) bool
}

// MetaString is a string metadata value
type MetaString string

func (m MetaString) AsString() (string, bool) { return string(m), true }
func (m MetaString) AsFloat() (float64, bool) { return 0, false }
func (m MetaString) AsBool() (bool, bool)     { return false, false }
func (m MetaString) Contains(value string) bool {
	return strings.Contains(string(m), value)
}

// MetaNumber is a numeric metadata value
type MetaNumber float64

func (m MetaNumber) AsString() (string, bool) { return "", false }
func (m MetaNumber) AsFloat() (float64, bool) { return float64(m), true }
func (m MetaNumber) AsBool() (bool, bool)     { return false, false }
func (m MetaNumber) Contains(value string) bool {
	return false
}

// MetaBool is a boolean metadata value
type MetaBool bool

func (m MetaBool) AsString() (string, bool) { return "", false }
func (m MetaBool) AsFloat() (float64, bool) { return 0, false }
func (m MetaBool) AsBool() (bool, bool)     { return bool(m), true }
func (m MetaBool) Contains(value string) bool {
	return false
}

// MetaArray is an array of strings metadata value
type MetaArray []string

func (m MetaArray) AsString() (string, bool) { return "", false }
func (m MetaArray) AsFloat() (float64, bool) { return 0, false }
func (m MetaArray) AsBool() (bool, bool)     { return false, false }
func (m MetaArray) Contains(value string) bool {
	for _, v := range m {
		if v == value {
			return true
		}
	}
	return false
}

// FilterCondition represents a filter predicate
type FilterCondition interface {
	Matches(meta map[string]MetaValue) bool
}

// Eq is an exact equality filter: field == value
type Eq struct {
	Field string
	Value MetaValue
}

func (f Eq) Matches(meta map[string]MetaValue) bool {
	v, ok := meta[f.Field]
	if !ok {
		return false
	}
	return metaValuesEqual(v, f.Value)
}

// Neq is a not-equal filter: field != value
type Neq struct {
	Field string
	Value MetaValue
}

func (f Neq) Matches(meta map[string]MetaValue) bool {
	v, ok := meta[f.Field]
	if !ok {
		// Missing field means it's not equal to any value
		return true
	}
	return !metaValuesEqual(v, f.Value)
}

// In checks if field value is in a list of values
type In struct {
	Field  string
	Values []string
}

func (f In) Matches(meta map[string]MetaValue) bool {
	v, ok := meta[f.Field]
	if !ok {
		return false
	}
	s, ok := v.AsString()
	if !ok {
		return false
	}
	for _, val := range f.Values {
		if val == s {
			return true
		}
	}
	return false
}

// Range checks if numeric field is within bounds
type Range struct {
	Field string
	Min   *float64
	Max   *float64
}

func (f Range) Matches(meta map[string]MetaValue) bool {
	v, ok := meta[f.Field]
	if !ok {
		return false
	}
	n, ok := v.AsFloat()
	if !ok {
		return false
	}

	if f.Min != nil && n < *f.Min {
		return false
	}
	if f.Max != nil && n > *f.Max {
		return false
	}
	return true
}

// Contains checks if field contains a value (for arrays or strings)
type Contains struct {
	Field string
	Value string
}

func (f Contains) Matches(meta map[string]MetaValue) bool {
	v, ok := meta[f.Field]
	if !ok {
		return false
	}
	return v.Contains(f.Value)
}

// And is a boolean AND of conditions
type And struct {
	Conditions []FilterCondition
}

func (f And) Matches(meta map[string]MetaValue) bool {
	for _, c := range f.Conditions {
		if !c.Matches(meta) {
			return false
		}
	}
	return true
}

// Or is a boolean OR of conditions
type Or struct {
	Conditions []FilterCondition
}

func (f Or) Matches(meta map[string]MetaValue) bool {
	if len(f.Conditions) == 0 {
		return false
	}
	for _, c := range f.Conditions {
		if c.Matches(meta) {
			return true
		}
	}
	return false
}

// FilterBuilder provides fluent filter construction
type FilterBuilder struct {
	conditions []FilterCondition
}

// NewFilterBuilder creates a new filter builder
func NewFilterBuilder() *FilterBuilder {
	return &FilterBuilder{
		conditions: make([]FilterCondition, 0),
	}
}

// Eq adds an equality condition
func (b *FilterBuilder) Eq(field string, value MetaValue) *FilterBuilder {
	b.conditions = append(b.conditions, Eq{Field: field, Value: value})
	return b
}

// Neq adds a not-equal condition
func (b *FilterBuilder) Neq(field string, value MetaValue) *FilterBuilder {
	b.conditions = append(b.conditions, Neq{Field: field, Value: value})
	return b
}

// In adds an in-list condition
func (b *FilterBuilder) In(field string, values []string) *FilterBuilder {
	b.conditions = append(b.conditions, In{Field: field, Values: values})
	return b
}

// Range adds a range condition
func (b *FilterBuilder) Range(field string, min, max *float64) *FilterBuilder {
	b.conditions = append(b.conditions, Range{Field: field, Min: min, Max: max})
	return b
}

// Contains adds a contains condition
func (b *FilterBuilder) Contains(field string, value string) *FilterBuilder {
	b.conditions = append(b.conditions, Contains{Field: field, Value: value})
	return b
}

// Build constructs the final filter condition
func (b *FilterBuilder) Build() FilterCondition {
	switch len(b.conditions) {
	case 0:
		return nil
	case 1:
		return b.conditions[0]
	default:
		return And{Conditions: b.conditions}
	}
}

// metaValuesEqual checks if two MetaValues are equal
func metaValuesEqual(a, b MetaValue) bool {
	// Try string comparison
	as, aok := a.AsString()
	bs, bok := b.AsString()
	if aok && bok {
		return as == bs
	}

	// Try float comparison
	af, aok := a.AsFloat()
	bf, bok := b.AsFloat()
	if aok && bok {
		return af == bf
	}

	// Try bool comparison
	ab, aok := a.AsBool()
	bb, bok := b.AsBool()
	if aok && bok {
		return ab == bb
	}

	return false
}
