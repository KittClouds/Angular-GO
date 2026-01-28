package builder

import (
	"sort"
	"strings"
	"unicode"

	"github.com/kittclouds/gokitt/pkg/reality/cst"
	rsyntax "github.com/kittclouds/gokitt/pkg/reality/syntax"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
)

// span represents a potential node in the tree
type span struct {
	kind     rsyntax.SyntaxKind
	start    int
	end      int
	priority int // Higher = Outer container
}

const (
	prioPara  = 90
	prioSent  = 80
	prioChunk = 50
	prioSpan  = 40 // Entity, Link
	prioToken = 10
)

// Zip constructs a CST from the source text and scan results
func Zip(text string, scan conductor.ScanResult) *cst.Node {
	spans := collectSpans(text, scan)

	// Sort: Start ASC, then Priority DESC (Container before Content), then Length DESC
	sort.Slice(spans, func(i, j int) bool {
		if spans[i].start != spans[j].start {
			return spans[i].start < spans[j].start
		}
		if spans[i].priority != spans[j].priority {
			return spans[i].priority > spans[j].priority // Higher priority first
		}
		return (spans[i].end - spans[i].start) > (spans[j].end - spans[j].start)
	})

	b := cst.NewBuilder()
	b.StartNode(rsyntax.KindDocument, 0)

	type event struct {
		offset   int
		isStart  bool
		kind     rsyntax.SyntaxKind
		priority int
		idx      int
	}

	var events []event
	for i, s := range spans {
		events = append(events, event{s.start, true, s.kind, s.priority, i})
		// End events prioritized: Inner ends before Outer
		events = append(events, event{s.end, false, s.kind, s.priority, i})
	}

	sort.Slice(events, func(i, j int) bool {
		if events[i].offset != events[j].offset {
			return events[i].offset < events[j].offset
		}
		// At same offset:
		// End events come before Start events (Close child before opening sibling)
		if !events[i].isStart && events[j].isStart {
			return true
		}
		if events[i].isStart && !events[j].isStart {
			return false
		}

		// If both Start: Outer (High Prio) first
		if events[i].isStart {
			return events[i].priority > events[j].priority
		}
		// If both End: Inner (Low Prio) first (Close child before parent)
		return events[i].priority < events[j].priority
	})

	cursor := 0

	// Active Loop
	// We need to handle whitespace gaps.

	for _, e := range events {
		// 1. Fill gap with whitespace/text
		if e.offset > cursor {
			b.Token(rsyntax.KindText, cursor, e.offset)
			cursor = e.offset
		}

		if e.isStart {
			b.StartNode(e.kind, e.offset)
		} else {
			// End event
			b.FinishNode()
		}
	}

	// Handle trailing text
	if cursor < len(text) {
		b.Token(rsyntax.KindText, cursor, len(text))
	}

	b.FinishNode() // Close Document
	return b.Finish()
}

func collectSpans(text string, scan conductor.ScanResult) []span {
	var spans []span

	// 1. Structure (Heuristic)
	// Paragraphs
	paras := splitRanges(text, "\n\n")
	for _, r := range paras {
		spans = append(spans, span{rsyntax.KindParagraph, r.Start, r.End, prioPara})

		// Sentences within Paragraph
		paraText := text[r.Start:r.End]
		sents := splitSentences(paraText)
		for _, s := range sents {
			spans = append(spans, span{rsyntax.KindSentence, r.Start + s.Start, r.Start + s.End, prioSent})
		}
	}

	// 2. Chunks
	for _, c := range scan.Chunks {
		kind := mapChunkKind(c.Kind)
		spans = append(spans, span{kind, c.Range.Start, c.Range.End, prioChunk})
	}

	// 3. Syntax Semantic Spans (Entities/Links)
	for _, m := range scan.Syntax {
		spans = append(spans, span{rsyntax.KindEntitySpan, m.Start, m.End, prioSpan})
	}

	// 4. Tokens (Leaves) - Reuse from Scanner
	for _, t := range scan.Tokens {
		kind := rsyntax.KindWord
		switch t.POS {
		case chunker.Punctuation:
			kind = rsyntax.KindPunctuation
		case chunker.Other:
			kind = rsyntax.KindWord
		}

		// Chunker tokens are [Start, End).
		spans = append(spans, span{kind, t.Range.Start, t.Range.End, prioToken})
	}

	return spans
}

func splitRanges(text, sep string) []chunker.TextRange {
	var ranges []chunker.TextRange
	parts := strings.Split(text, sep)
	offset := 0
	sepLen := len(sep)
	for _, p := range parts {
		end := offset + len(p)
		if len(p) > 0 {
			ranges = append(ranges, chunker.TextRange{Start: offset, End: end})
		}
		offset = end + sepLen
	}
	return ranges
}

func splitSentences(text string) []chunker.TextRange {
	// Simple heuristic: split by .!?
	var ranges []chunker.TextRange
	start := 0
	for i, r := range text {
		if r == '.' || r == '!' || r == '?' {
			ranges = append(ranges, chunker.TextRange{Start: start, End: i + 1})
			start = i + 1
			// Skip whitespace after
			for start < len(text) && unicode.IsSpace(rune(text[start])) {
				start++
			}
		}
	}
	if start < len(text) {
		ranges = append(ranges, chunker.TextRange{Start: start, End: len(text)})
	}
	return ranges
}

func mapChunkKind(k chunker.ChunkKind) rsyntax.SyntaxKind {
	switch k {
	case chunker.NounPhrase:
		return rsyntax.KindNounPhrase
	case chunker.VerbPhrase:
		return rsyntax.KindVerbPhrase
	case chunker.PrepPhrase:
		return rsyntax.KindPrepPhrase
	case chunker.AdjPhrase:
		return rsyntax.KindAdjPhrase
	case chunker.Clause:
		return rsyntax.KindSubClause
	default:
		return rsyntax.KindText
	}
}
