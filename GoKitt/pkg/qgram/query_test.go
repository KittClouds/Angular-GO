package qgram

import (
	"testing"
)

func TestParseQuery(t *testing.T) {
	tests := []struct {
		input    string
		expected []Clause
	}{
		{
			input: "hello world",
			expected: []Clause{
				{Pattern: "hello", Type: TermClause, RawInput: "hello"},
				{Pattern: "world", Type: TermClause, RawInput: "world"},
			},
		},
		{
			input: `"hello world"`,
			expected: []Clause{
				{Pattern: "hello world", Type: PhraseClause, RawInput: "hello world"},
			},
		},
		{
			input: `term "quoted phrase" term2`,
			expected: []Clause{
				{Pattern: "term", Type: TermClause, RawInput: "term"},
				{Pattern: "quoted phrase", Type: PhraseClause, RawInput: "quoted phrase"},
				{Pattern: "term2", Type: TermClause, RawInput: "term2"},
			},
		},
		{
			input: `Mixed case "Phrase"`,
			expected: []Clause{
				{Pattern: "mixed", Type: TermClause, RawInput: "Mixed"},
				{Pattern: "case", Type: TermClause, RawInput: "case"},
				{Pattern: "phrase", Type: PhraseClause, RawInput: "Phrase"},
			},
		},
		{
			input: `unclosed "quote logic`,
			expected: []Clause{
				{Pattern: "unclosed", Type: TermClause, RawInput: "unclosed"},
				{Pattern: "quote logic", Type: TermClause, RawInput: "quote logic"}, // Unclosed treats remainder as term
			},
		},
		{
			input: `   "padding"   `,
			expected: []Clause{
				{Pattern: "padding", Type: PhraseClause, RawInput: "padding"},
			},
		},
	}

	for _, tc := range tests {
		got := ParseQuery(tc.input)
		if len(got) != len(tc.expected) {
			t.Errorf("Input: %s. Expected %d clauses, got %d", tc.input, len(tc.expected), len(got))
			continue
		}
		for i, c := range got {
			if c.Pattern != tc.expected[i].Pattern || c.Type != tc.expected[i].Type {
				t.Errorf("Input: %s. Clause %d mismatch. Got %+v, want %+v", tc.input, i, c, tc.expected[i])
			}
		}
	}
}
