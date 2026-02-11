package qgram

import (
	"strings"
)

type MatchDetail struct {
	Count       int
	FieldLength int
	Positions   []int // start indices of each occurrence (for phrase-distance)
}

type PatternMatch struct {
	FieldMatches map[string]MatchDetail // field -> details
	SegmentMask  uint32                 // 32-bit mask of which segments contain hits
	TotalOcc     int
}

// VerifyCandidate checks if a doc actually contains the exact pattern clause
// Returns nil if no match found (false positive)
func (idx *QGramIndex) VerifyCandidate(docID string, clause Clause) *PatternMatch {
	doc, ok := idx.Documents[docID]
	if !ok {
		return nil
	}

	match := &PatternMatch{
		FieldMatches: make(map[string]MatchDetail),
	}

	pattern := clause.Pattern
	foundAny := false

	for field, content := range doc.Fields {
		normalized := NormalizeText(content)
		fieldLen := len(normalized)

		positions := findPositions(normalized, pattern)
		if len(positions) > 0 {
			count := len(positions)
			match.FieldMatches[field] = MatchDetail{
				Count:       count,
				FieldLength: fieldLen,
				Positions:   positions,
			}
			match.TotalOcc += count
			foundAny = true

			// Update Segment Mask
			// Avoid div by zero
			if fieldLen > 0 {
				for _, pos := range positions {
					segIdx := (pos * 32) / fieldLen
					if segIdx >= 32 {
						segIdx = 31
					}
					match.SegmentMask |= (1 << segIdx)
				}
			}
		}
	}

	if !foundAny {
		return nil
	}

	return match
}

// findPositions returns start indices of overlapping matches
func findPositions(s, substr string) []int {
	if len(substr) == 0 {
		return nil
	}
	var positions []int
	idx := 0
	for {
		i := strings.Index(s[idx:], substr)
		if i == -1 {
			break
		}
		absPos := idx + i
		positions = append(positions, absPos)
		// Overlap: advance by 1
		idx += i + 1
	}
	return positions
}
