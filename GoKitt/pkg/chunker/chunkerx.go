package chunker

import (
	"bytes"
	"strings"
	"sync"
	"unsafe"

	"github.com/coregx/ahocorasick"
)

// ============================================================================
// Chapter Detection Types
// ============================================================================

// BoundaryKind represents the type of chapter boundary detected.
type BoundaryKind int

const (
	BoundaryNone    BoundaryKind = iota // Not a chapter boundary
	BoundaryChapter                     // Major chapter/section header
	BoundarySection                     // Minor section header
)

// ChapterBoundary represents a detected chapter boundary.
type ChapterBoundary struct {
	LineNum int          // 1-based line number
	Start   int          // Byte offset in document
	End     int          // Byte offset of line end
	Title   string       // Extracted title text
	Kind    BoundaryKind // Type of boundary
}

// ChapterDetector is the interface for chapter detection strategies.
type ChapterDetector interface {
	Detect(data []byte) []ChapterBoundary
}

// ChunkTreeExtended holds the hierarchical chunk structure with chapters.
type ChunkTreeExtended struct {
	Chapters []Chunk // Level 2: Chapter-level chunks
	Parents  []Chunk // Level 1: Parent/context chunks
	Leaves   []Chunk // Level 0: Leaf/retrieval chunks
}

// defaultChapterKeywords are the keywords used for Aho-Corasick detection.
var defaultChapterKeywords = []string{
	"Chapter",
	"CHAPTER",
	"Part",
	"PART",
	"Section",
	"SECTION",
	"Introduction",
	"INTRODUCTION",
	"Conclusion",
	"CONCLUSION",
	"Abstract",
	"ABSTRACT",
	"Summary",
	"SUMMARY",
	"Appendix",
	"APPENDIX",
	"#", // Markdown headers
}

// ============================================================================
// ChunkerX2 - Ultra-High-Performance Structure-Aware Chunker
// ============================================================================
//
// ChunkerX2 extends ChunkerX with additional memory optimizations:
//
// 1. ZERO-COPY string to []byte conversion using unsafe.Slice
// 2. Per-document mapper reset (prevents unbounded cache growth)
// 3. STREAMING Aho-Corasick iterator (O(1) memory vs O(N) matches slice)
// 4. BYTE-LEVEL newline replacement (single allocation, breaks source ref)
//
// These optimizations eliminate memory spikes and prevent memory leaks
// in production environments processing many documents.
//
// ============================================================================

// ============================================================================
// AhoCorasickDetector2 - Streaming Iterator Implementation
// ============================================================================

// AhoCorasickDetector2 uses streaming iteration for O(1) match memory.
type AhoCorasickDetector2 struct {
	automaton *ahocorasick.Automaton
	keywords  [][]byte
	debug     bool
}

// NewAhoCorasickDetector2 creates a new streaming detector.
func NewAhoCorasickDetector2() *AhoCorasickDetector2 {
	return NewAhoCorasickDetector2WithKeywords(defaultChapterKeywords)
}

// NewAhoCorasickDetector2WithKeywords creates a detector with custom keywords.
func NewAhoCorasickDetector2WithKeywords(keywords []string) *AhoCorasickDetector2 {
	builder := ahocorasick.NewBuilder()
	builder.SetMatchKind(ahocorasick.LeftmostFirst)

	keywordsBytes := make([][]byte, len(keywords))
	for i, kw := range keywords {
		keywordsBytes[i] = []byte(kw)
	}
	builder.AddPatterns(keywordsBytes)

	automaton, err := builder.Build()
	if err != nil {
		panic("failed to build Aho-Corasick automaton: " + err.Error())
	}

	return &AhoCorasickDetector2{
		automaton: automaton,
		keywords:  keywordsBytes,
		debug:     false,
	}
}

// SetDebug enables debug output.
func (d *AhoCorasickDetector2) SetDebug(debug bool) {
	d.debug = debug
}

// Detect finds all chapter boundaries using STREAMING iteration.
// This uses O(1) memory for matches instead of O(N) with FindAllOverlapping.
func (d *AhoCorasickDetector2) Detect(data []byte) []ChapterBoundary {
	if len(data) == 0 {
		return nil
	}

	// Preallocate boundaries with reasonable initial capacity
	boundaries := make([]ChapterBoundary, 0, 64)

	// Stateful pointer instead of map - tracks last processed line start
	lastLineStart := -1

	// STREAMING ITERATOR: Process matches one at a time
	// This is O(1) memory for matches vs O(N) with FindAllOverlapping
	start := 0
	for {
		match := d.automaton.Find(data, start)
		if match == nil {
			break
		}

		// Move to next position for next iteration
		start = match.Start + 1

		// Find line boundaries by scanning backward/forward from match position
		lineStart, lineEnd := findLineBounds(data, match.Start)

		// Skip if we've already processed this line
		if lineStart == lastLineStart {
			continue
		}
		lastLineStart = lineStart

		// Extract the line
		line := data[lineStart:lineEnd]

		// Validate: is this actually a chapter header?
		title, kind := d.validateLine(line)
		if kind == BoundaryNone {
			continue
		}

		// Valid chapter boundary found
		boundaries = append(boundaries, ChapterBoundary{
			LineNum: countLines(data, lineStart),
			Start:   lineStart,
			End:     lineEnd,
			Title:   title,
			Kind:    kind,
		})

		if d.debug {
			lineStr := string(line)
			if len(lineStr) > 60 {
				lineStr = lineStr[:60] + "..."
			}
			println("[DEBUG] Chapter detected at line", countLines(data, lineStart), ":", lineStr)
		}
	}

	// Phase 2: Scan for numbered sections
	boundaries = d.detectNumberedSections(data, boundaries, &lastLineStart)

	return boundaries
}

// detectNumberedSections scans for numbered sections in Phase 2.
func (d *AhoCorasickDetector2) detectNumberedSections(data []byte, boundaries []ChapterBoundary, lastLineStart *int) []ChapterBoundary {
	lineStart := 0
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' || i == len(data)-1 {
			lineEnd := i
			if data[i] != '\n' {
				lineEnd = len(data)
			}

			if lineStart != *lastLineStart {
				line := data[lineStart:lineEnd]

				if title, ok := d.validateNumberedSection(line); ok {
					boundaries = append(boundaries, ChapterBoundary{
						LineNum: countLines(data, lineStart),
						Start:   lineStart,
						End:     lineEnd,
						Title:   title,
						Kind:    BoundarySection,
					})
				}
			}

			lineStart = i + 1
		}
	}

	return boundaries
}

// validateLine checks if a line is a valid chapter header.
func (d *AhoCorasickDetector2) validateLine(line []byte) (string, BoundaryKind) {
	if len(line) == 0 {
		return "", BoundaryNone
	}

	line = stripLeadingWhitespace(line)

	// Check for markdown headers
	if len(line) >= 2 && line[0] == '#' {
		hashCount := 0
		for i := 0; i < len(line) && line[i] == '#'; i++ {
			hashCount++
		}
		if hashCount >= 1 && hashCount <= 6 {
			rest := stripLeadingWhitespace(line[hashCount:])
			if ok := validateChapterTitleBytes(rest); ok {
				return string(line), BoundaryChapter
			}
			if ok := validatePartTitleBytes(rest); ok {
				return string(line), BoundaryChapter
			}
			return string(line), BoundarySection
		}
	}

	if ok := validateChapterTitleBytes(line); ok {
		return string(line), BoundaryChapter
	}

	if ok := validatePartTitleBytes(line); ok {
		return string(line), BoundaryChapter
	}

	if ok := validateNumberedSectionBytes(line); ok {
		return string(line), BoundarySection
	}

	return "", BoundaryNone
}

// validateNumberedSection returns the title string for compatibility.
func (d *AhoCorasickDetector2) validateNumberedSection(line []byte) (string, bool) {
	if validateNumberedSectionBytes(line) {
		return string(line), true
	}
	return "", false
}

// ============================================================================
// ChunkerX2 - Ultra-High-Performance Chunker
// ============================================================================

// ChunkerX2 is an ultra-high-performance structure-aware chunker.
type ChunkerX2 struct {
	// Leaf behavior (retrieval units)
	ChunkSize int
	Overlap   int

	// Parent behavior (context units)
	ParentChunkSize int
	ParentOverlap   int

	// Output options
	OutputWithoutNewline bool
	Debug                bool

	// Detection
	detector *AhoCorasickDetector2

	// ID management - created fresh per document to prevent unbounded growth
	Mapper *ChunkIDMapper

	// internal - reusable buffer for current span accumulation only
	curSpans []SentenceSpan
}

// NewChunkerX2 creates a new ultra-high-performance chunker.
func NewChunkerX2(chunkSize, overlap int) *ChunkerX2 {
	if chunkSize <= 0 {
		chunkSize = 150
	}
	if overlap <= 0 {
		overlap = 30
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 4
	}

	parentSize := chunkSize * 4
	parentOverlap := chunkSize
	if parentOverlap >= parentSize {
		parentOverlap = parentSize / 4
	}

	return &ChunkerX2{
		ChunkSize:       chunkSize,
		Overlap:         overlap,
		ParentChunkSize: parentSize,
		ParentOverlap:   parentOverlap,
		detector:        NewAhoCorasickDetector2(),
		// Mapper is created fresh per document - don't pre-create
		curSpans: make([]SentenceSpan, 0, 32),
	}
}

// SetDebug enables debug output.
func (c *ChunkerX2) SetDebug(debug bool) {
	c.Debug = debug
	c.detector.SetDebug(debug)
}

// ChunkDocumentExtended chunks a document with all memory optimizations.
func (c *ChunkerX2) ChunkDocumentExtended(docID, data string) ChunkTreeExtended {
	// OPTIMIZATION 2: Create fresh mapper per document
	// This prevents unbounded cache growth when processing many documents
	c.Mapper = NewChunkIDMapperOptimized()

	// OPTIMIZATION 1: Zero-copy string to []byte conversion
	// unsafe.Slice(unsafe.StringData(data), len(data)) avoids the full
	// allocation and copy that []byte(data) would cause.
	// This is safe because the detector only reads from the slice,
	// and any returned strings (like titles) are copied via string(line).
	bytesData := unsafe.Slice(unsafe.StringData(data), len(data))

	// Detect chapter boundaries using streaming iterator
	boundaries := c.detector.Detect(bytesData)

	// Build chapter chunks
	chapters := c.buildChapterChunks(docID, data, boundaries)

	// Build leaf and parent chunks
	sentences := SplitSentencesWithSpans(data, defaultAbbreviations)
	if len(sentences) == 0 {
		return ChunkTreeExtended{Leaves: nil, Parents: nil, Chapters: chapters}
	}

	leaves := c.buildLeafChunks(docID, data, sentences)
	parents := c.buildParentChunks(docID, leaves)

	return ChunkTreeExtended{
		Leaves:   leaves,
		Parents:  parents,
		Chapters: chapters,
	}
}

// buildChapterChunks creates chapter-level chunks from detected boundaries.
func (c *ChunkerX2) buildChapterChunks(docID, data string, boundaries []ChapterBoundary) []Chunk {
	if len(boundaries) == 0 {
		return nil
	}

	chunks := make([]Chunk, 0, len(boundaries))

	for i, b := range boundaries {
		end := len(data)
		if i+1 < len(boundaries) {
			end = boundaries[i+1].Start
		}

		key := ChunkKey{DocID: docID, Level: 2, Start: b.Start, End: end}
		id := c.Mapper.GetOrAssignKey(key)

		chunks = append(chunks, Chunk{
			ID:    id,
			DocID: docID,
			Level: 2,
			Index: i,
			Start: b.Start,
			End:   end,
			Text:  strings.TrimSpace(b.Title),
		})
	}

	return chunks
}

// buildLeafChunks creates leaf chunks with OPTIMIZATION 4: byte-level newline replacement.
func (c *ChunkerX2) buildLeafChunks(docID, data string, sentences []SentenceSpan) []Chunk {
	if c.ChunkSize <= 0 {
		c.ChunkSize = 150
	}
	if c.Overlap < 0 {
		c.Overlap = 0
	}
	if c.Overlap >= c.ChunkSize {
		c.Overlap = c.ChunkSize / 4
	}

	c.curSpans = c.curSpans[:0]
	curLen := 0

	estimatedChunks := len(sentences) / 4
	if estimatedChunks < 16 {
		estimatedChunks = 16
	}
	chunks := make([]Chunk, 0, estimatedChunks)

	emit := func() {
		if len(c.curSpans) == 0 {
			return
		}
		start := c.curSpans[0].Start
		end := c.curSpans[len(c.curSpans)-1].End

		// OPTIMIZATION 4: Smart byte-level processing
		// Only allocate when we need to modify (newline replacement) or trim
		rawSlice := data[start:end]

		var text string
		if c.OutputWithoutNewline {
			// Check if there are any newlines first (avoid allocation if not)
			hasNewline := strings.IndexByte(rawSlice, '\n') != -1

			if hasNewline {
				// Allocate and modify in one pass
				rawBytes := []byte(rawSlice)
				for i := 0; i < len(rawBytes); i++ {
					if rawBytes[i] == '\n' {
						rawBytes[i] = ' '
					}
				}
				text = string(bytes.TrimSpace(rawBytes))
			} else {
				// No newlines, just trim
				text = strings.TrimSpace(rawSlice)
			}
		} else {
			// Just trim - no allocation needed
			text = strings.TrimSpace(rawSlice)
		}

		if len(text) == 0 {
			return
		}

		key := ChunkKey{DocID: docID, Level: 0, Start: start, End: end}
		id := c.Mapper.GetOrAssignKey(key)

		chunks = append(chunks, Chunk{
			ID:    id,
			DocID: docID,
			Level: 0,
			Index: len(chunks),
			Start: start,
			End:   end,
			Text:  text,
		})
	}

	for i := 0; i < len(sentences); i++ {
		s := sentences[i]
		sLen := spanLenApprox(s)

		if curLen > 0 && curLen+sLen > c.ChunkSize {
			emit()

			overlapLen := 0
			startIndex := len(c.curSpans)
			for j := len(c.curSpans) - 1; j >= 0; j-- {
				l := spanLenApprox(c.curSpans[j])
				if overlapLen+l > c.Overlap {
					break
				}
				overlapLen += l
				startIndex = j
			}
			if startIndex < len(c.curSpans) {
				n := copy(c.curSpans, c.curSpans[startIndex:])
				c.curSpans = c.curSpans[:n]
				curLen = overlapLen
			} else {
				c.curSpans = c.curSpans[:0]
				curLen = 0
			}

			if len(c.curSpans) == 0 && sLen > c.ChunkSize {
				c.curSpans = append(c.curSpans, s)
				curLen = sLen
				emit()
				c.curSpans = c.curSpans[:0]
				curLen = 0
				continue
			}
		}

		c.curSpans = append(c.curSpans, s)
		curLen += sLen
	}

	emit()
	return chunks
}

// buildParentChunks creates parent chunks from leaves.
func (c *ChunkerX2) buildParentChunks(docID string, leaves []Chunk) []Chunk {
	if len(leaves) == 0 {
		return nil
	}
	if c.ParentChunkSize <= 0 {
		c.ParentChunkSize = c.ChunkSize * 4
	}
	if c.ParentOverlap < 0 {
		c.ParentOverlap = 0
	}
	if c.ParentOverlap >= c.ParentChunkSize {
		c.ParentOverlap = c.ParentChunkSize / 4
	}

	estimatedParents := len(leaves) / 8
	if estimatedParents < 8 {
		estimatedParents = 8
	}
	parents := make([]Chunk, 0, estimatedParents)

	curChildIDs := make([]uint32, 0, 16)
	curStart := 0
	curLen := 0

	emit := func(endIdx int) {
		if len(curChildIDs) == 0 {
			return
		}

		start := leaves[curStart].Start
		end := leaves[endIdx-1].End

		key := ChunkKey{DocID: docID, Level: 1, Start: start, End: end}
		id := c.Mapper.GetOrAssignKey(key)

		// Allocate fresh slice for ChildIDs
		childIDsCopy := make([]uint32, len(curChildIDs))
		copy(childIDsCopy, curChildIDs)

		parents = append(parents, Chunk{
			ID:       id,
			DocID:    docID,
			Level:    1,
			Index:    len(parents),
			Start:    start,
			End:      end,
			ChildIDs: childIDsCopy,
		})

		for i := curStart; i < endIdx; i++ {
			leaves[i].ParentID = id
		}
	}

	for i, leaf := range leaves {
		leafLen := leaf.End - leaf.Start

		if curLen > 0 && curLen+leafLen > c.ParentChunkSize {
			emit(i)

			overlapLen := 0
			newStart := curStart
			for j := curStart; j < i; j++ {
				l := leaves[j].End - leaves[j].Start
				if overlapLen+l > c.ParentOverlap {
					break
				}
				overlapLen += l
				newStart = j + 1
			}

			curStart = newStart
			curLen = overlapLen
			curChildIDs = curChildIDs[:0]
			for j := curStart; j < i; j++ {
				curChildIDs = append(curChildIDs, leaves[j].ID)
			}
		}

		curChildIDs = append(curChildIDs, leaf.ID)
		curLen += leafLen
	}

	emit(len(leaves))
	return parents
}

// ============================================================================
// Global Detector Instance (for reuse)
// ============================================================================

var (
	globalDetector2     *AhoCorasickDetector2
	globalDetector2Once sync.Once
)

// GetGlobalDetector2 returns a shared AhoCorasickDetector2 instance.
func GetGlobalDetector2() *AhoCorasickDetector2 {
	globalDetector2Once.Do(func() {
		globalDetector2 = NewAhoCorasickDetector2()
	})
	return globalDetector2
}

// Validate that AhoCorasickDetector2 implements ChapterDetector
var _ ChapterDetector = (*AhoCorasickDetector2)(nil)

// ============================================================================
// Helper Functions for Chapter Detection
// ============================================================================

// findLineBounds finds the start and end of the line containing position pos.
func findLineBounds(data []byte, pos int) (start, end int) {
	// Scan backward to find line start
	start = pos
	for start > 0 && data[start-1] != '\n' {
		start--
	}
	// Scan forward to find line end
	end = pos
	for end < len(data) && data[end] != '\n' {
		end++
	}
	return start, end
}

// countLines counts the number of newlines before position pos (1-based).
func countLines(data []byte, pos int) int {
	count := 1
	for i := 0; i < pos && i < len(data); i++ {
		if data[i] == '\n' {
			count++
		}
	}
	return count
}

// stripLeadingWhitespace removes leading whitespace from a byte slice.
func stripLeadingWhitespace(line []byte) []byte {
	for len(line) > 0 {
		b := line[0]
		if b == ' ' || b == '\t' || b == '\r' || b == '\n' {
			line = line[1:]
			continue
		}
		break
	}
	return line
}

// validateChapterTitleBytes checks if the line starts with "Chapter" or "CHAPTER".
func validateChapterTitleBytes(line []byte) bool {
	if len(line) < 8 {
		return false
	}
	return hasPrefixIgnoreCase(line, "chapter")
}

// validatePartTitleBytes checks if the line starts with "Part" or "PART".
func validatePartTitleBytes(line []byte) bool {
	if len(line) < 5 {
		return false
	}
	return hasPrefixIgnoreCase(line, "part")
}

// validateNumberedSectionBytes checks if the line is a numbered section (e.g., "1.", "2.1", etc.).
func validateNumberedSectionBytes(line []byte) bool {
	if len(line) < 2 {
		return false
	}

	// Skip leading whitespace
	line = stripLeadingWhitespace(line)
	if len(line) < 2 {
		return false
	}

	// Must start with a digit
	if line[0] < '0' || line[0] > '9' {
		return false
	}

	// Find the end of the number section
	i := 0
	for i < len(line) && (line[i] >= '0' && line[i] <= '9' || line[i] == '.') {
		i++
	}

	// Must have at least one digit and be followed by whitespace or end
	if i == 0 {
		return false
	}

	// Check what follows the number
	if i >= len(line) {
		return false // Just a number, not a section
	}

	// Must be followed by space, tab, or punctuation
	next := line[i]
	return next == ' ' || next == '\t' || next == ':' || next == ')'
}

// hasPrefixIgnoreCase checks if byte slice has prefix, case-insensitive.
func hasPrefixIgnoreCase(data []byte, prefix string) bool {
	if len(data) < len(prefix) {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		c := data[i]
		p := prefix[i]
		// Branchless ASCII case-folding
		if c >= 'A' && c <= 'Z' {
			c += 32
		}
		if p >= 'A' && p <= 'Z' {
			p += 32
		}
		if c != p {
			return false
		}
	}
	return true
}
