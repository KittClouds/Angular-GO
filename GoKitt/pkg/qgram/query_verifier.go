package qgram

import (
	aho_corasick "github.com/petar-dambovaliev/aho-corasick"
)

// QueryVerifier builds an Aho-Corasick automaton from query clauses
// for efficient one-pass verification of all patterns simultaneously.
type QueryVerifier struct {
	AC      aho_corasick.AhoCorasick
	Clauses []Clause // index-aligned with AC patterns
}

// NewQueryVerifier creates a QueryVerifier from a slice of clauses.
// Patterns are already normalized by ParseQuery/NormalizeText.
// Uses StandardMatch to allow IterOverlapping (required by the AC library).
func NewQueryVerifier(clauses []Clause) QueryVerifier {
	if len(clauses) == 0 {
		return QueryVerifier{}
	}

	pats := make([]string, len(clauses))
	for i, c := range clauses {
		pats[i] = c.Pattern // already normalized by ParseQuery/NormalizeText
	}

	b := aho_corasick.NewAhoCorasickBuilder(aho_corasick.Opts{
		AsciiCaseInsensitive: false,                      // we lowercase already
		MatchOnlyWholeWords:  false,                      // keep substring semantics
		MatchKind:            aho_corasick.StandardMatch, // required for IterOverlapping
		DFA:                  false,                      // tune later; keep simple
	})
	ac := b.Build(pats)

	return QueryVerifier{AC: ac, Clauses: clauses}
}

// VerifyCandidateAll verifies all clauses against a document in one pass.
// Returns a matches slice aligned with clauses (nil means "no match for that clause"),
// plus matchedCount so coverage logic stays intact.
// This preserves current semantics: lowercased normalization, overlapping matches,
// positions collected, per-pattern segment masks.
func (idx *QGramIndex) VerifyCandidateAll(
	docID string,
	qv *QueryVerifier,
) (matches []*PatternMatch, matchedCount int) {
	doc, ok := idx.Documents[docID]
	if !ok {
		return nil, 0
	}

	if len(qv.Clauses) == 0 {
		return nil, 0
	}

	matches = make([]*PatternMatch, len(qv.Clauses))

	for field, content := range doc.Fields {
		normalized := NormalizeText(content)
		fieldLen := len(normalized)
		if fieldLen == 0 {
			continue
		}

		// Overlapping to match current findPositions() behavior (advance by 1).
		iter := qv.AC.IterOverlapping(normalized)
		for {
			m := iter.Next()
			if m == nil {
				break
			}

			patIdx := m.Pattern()
			start := m.Start()

			// Bounds check for safety
			if patIdx >= len(matches) {
				continue
			}

			pm := matches[patIdx]
			if pm == nil {
				pm = &PatternMatch{
					FieldMatches: make(map[string]MatchDetail),
				}
				matches[patIdx] = pm
				matchedCount++
			}

			md := pm.FieldMatches[field]
			if md.FieldLength == 0 {
				md.FieldLength = fieldLen
			} else if md.FieldLength != fieldLen {
				// Shouldn't happen in this loop, but keep invariants sane.
				md.FieldLength = fieldLen
			}
			md.Count++
			md.Positions = append(md.Positions, start)
			pm.FieldMatches[field] = md

			pm.TotalOcc++

			// Segment mask exactly like existing verifier.
			segIdx := (start * 32) / fieldLen
			if segIdx >= 32 {
				segIdx = 31
			}
			pm.SegmentMask |= (1 << segIdx)
		}
	}

	if matchedCount == 0 {
		return nil, 0
	}
	return matches, matchedCount
}
