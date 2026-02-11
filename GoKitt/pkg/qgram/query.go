package qgram

import (
	"strings"
	"unicode"
)

type ClauseType int

const (
	TermClause   ClauseType = iota
	PhraseClause            // quoted "exact substring"
)

type Clause struct {
	Pattern  string // normalized pattern text
	Type     ClauseType
	RawInput string // original pre-normalization
}

// NormalizeText applies normalization consistent with indexing
// Currently just lowercasing, can be extended for diacritics later.
func NormalizeText(s string) string {
	return strings.ToLower(s)
}

// ParseQuery splits user input into clauses.
// Quotes denote phrases. Unclosed quotes are treated as terms.
func ParseQuery(input string) []Clause {
	var clauses []Clause
	var current strings.Builder
	inQuote := false

	// Helper to finalize a term clause
	addTerm := func() {
		if current.Len() > 0 {
			raw := current.String()
			clauses = append(clauses, Clause{
				Pattern:  NormalizeText(raw),
				Type:     TermClause,
				RawInput: raw,
			})
			current.Reset()
		}
	}

	for _, r := range input {
		if r == '"' {
			if inQuote {
				// End of quoted phrase
				raw := current.String()
				if len(raw) > 0 {
					clauses = append(clauses, Clause{
						Pattern:  NormalizeText(raw),
						Type:     PhraseClause,
						RawInput: raw,
					})
				}
				current.Reset()
				inQuote = false
			} else {
				// Start of quoted phrase
				addTerm() // flush any preceding term
				inQuote = true
			}
		} else if unicode.IsSpace(r) && !inQuote {
			addTerm()
		} else {
			current.WriteRune(r)
		}
	}

	// Flush any remaining term (if not in quote, or if quote was unclosed)
	addTerm()

	return clauses
}
