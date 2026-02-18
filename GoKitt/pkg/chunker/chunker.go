package chunker

import (
	"strings"
	"sync"
	"unicode"

	"github.com/coregx/coregex"
)

// ============================================================================
// ChunkIDMapper - "IDs never reused" invariant
// ============================================================================

// ChunkIDMapper assigns sequential uint32 IDs to chunks with the guarantee
// that IDs are never reused. This aligns with the DocIDMapper pattern used
// in qgram for hybrid index integration.
type ChunkIDMapper struct {
	mu       sync.RWMutex
	nextID   uint32
	byString map[string]uint32 // chunk key -> uint32 ID
	byID     map[uint32]string // uint32 ID -> chunk key
	byDoc    map[uint32]string // uint32 ID -> docID
}

// NewChunkIDMapper creates a new mapper
func NewChunkIDMapper() *ChunkIDMapper {
	return &ChunkIDMapper{
		nextID:   1, // 0 is reserved for "not found"
		byString: make(map[string]uint32),
		byID:     make(map[uint32]string),
		byDoc:    make(map[uint32]string),
	}
}

// GetOrAssign returns the uint32 ID for a chunk key, assigning a new one if needed.
// The key should be a unique identifier for the chunk (e.g., "docID:start:end").
func (m *ChunkIDMapper) GetOrAssign(key, docID string) uint32 {
	m.mu.Lock()
	defer m.mu.Unlock()

	if id, ok := m.byString[key]; ok {
		return id
	}

	id := m.nextID
	m.nextID++
	m.byString[key] = id
	m.byID[id] = key
	m.byDoc[id] = docID
	return id
}

// Get returns the uint32 ID for a key, or 0 if not found.
func (m *ChunkIDMapper) Get(key string) uint32 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.byString[key]
}

// GetString returns the chunk key for an ID, or "" if not found.
func (m *ChunkIDMapper) GetString(id uint32) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.byID[id]
}

// GetDocID returns the document ID for a chunk ID, or "" if not found.
func (m *ChunkIDMapper) GetDocID(chunkID uint32) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.byDoc[chunkID]
}

// Len returns the number of assigned IDs.
func (m *ChunkIDMapper) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.byString)
}

// NextID returns the next ID that will be assigned (for testing/debugging).
func (m *ChunkIDMapper) NextID() uint32 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.nextID
}

// GetAll returns all mappings as id -> chunk key.
// Used for persistence.
func (m *ChunkIDMapper) GetAll() map[uint32]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make(map[uint32]string, len(m.byID))
	for id, key := range m.byID {
		result[id] = key
	}
	return result
}

// GetAllKeys returns all mappings as id -> chunk key.
// Used for persistence (alias for interface compatibility).
func (m *ChunkIDMapper) GetAllKeys() map[uint32]string {
	return m.GetAll()
}

// Restore restores a specific id -> key/docID mapping.
// Used for loading persisted state. The nextID is updated if needed.
func (m *ChunkIDMapper) Restore(id uint32, key, docID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.byString[key] = id
	m.byID[id] = key
	m.byDoc[id] = docID
	if id >= m.nextID {
		m.nextID = id + 1
	}
}

// ============================================================================
// Chunk - Now uses uint32 IDs
// ============================================================================

// Chunk represents a text chunk with uint32 ID for hybrid index integration.
type Chunk struct {
	ID       uint32   // Sequential uint32 ID (from ChunkIDMapper)
	DocID    string   // Source document ID
	Level    uint8    // 0 = leaf (retrieval unit), 1 = parent (context unit)
	Index    int      // Stable ordering within its level for this run
	Start    int      // Byte offset in original data (inclusive)
	End      int      // Byte offset in original data (exclusive)
	Text     string   // Chunk text content
	ParentID uint32   // For leaves: parent chunk ID (0 if none)
	ChildIDs []uint32 // For parents: child chunk IDs
}

// ChunkTree holds the hierarchical chunk structure.
type ChunkTree struct {
	Leaves  []Chunk
	Parents []Chunk
}

// SentenceSpan preserves the mapping back to the original document.
type SentenceSpan struct {
	Start int
	End   int
	Text  string
}

// ============================================================================
// Chunker
// ============================================================================

// Chunker splits documents into hierarchical chunks.
type Chunker struct {
	// Leaf behavior (retrieval units)
	ChunkSize int // Approx bytes, not tokens
	Overlap   int // Approx bytes, not tokens

	// Parent behavior (context units)
	ParentChunkSize int
	ParentOverlap   int

	Separators           []string
	OutputWithoutNewline bool
	Debug                bool

	// ID management
	Mapper *ChunkIDMapper

	// internal
	leaves  []Chunk
	parents []Chunk
}

var (
	DefaultSeparators = []string{"\n\n", " ", "\n"}

	// Sentence boundary: punctuation followed by whitespace.
	sentBoundaryRe = coregex.MustCompile(`([.?!])\s+`)

	// Common abbreviations to avoid splitting on.
	defaultAbbreviations = []string{"Mr.", "Mrs.", "Dr.", "Ms.", "Jr.", "Sr.", "Prof.", "St."}
)

// NewChunker creates a new chunker with default mapper.
func NewChunker(chunkSize, overlap int, separators []string, outputWithoutNewline, debug bool) *Chunker {
	if chunkSize <= 0 {
		chunkSize = 150
	}
	if overlap <= 0 {
		overlap = 30
	}
	if overlap >= chunkSize {
		overlap = chunkSize / 4
	}
	if len(separators) == 0 {
		separators = DefaultSeparators
	}

	// Parents: default to ~4x leaf size with a leaf-sized overlap.
	parentSize := chunkSize * 4
	parentOverlap := chunkSize
	if parentOverlap >= parentSize {
		parentOverlap = parentSize / 4
	}

	return &Chunker{
		ChunkSize:            chunkSize,
		Overlap:              overlap,
		ParentChunkSize:      parentSize,
		ParentOverlap:        parentOverlap,
		Separators:           separators,
		OutputWithoutNewline: outputWithoutNewline,
		Debug:                debug,
		Mapper:               NewChunkIDMapper(),
		leaves:               nil,
		parents:              nil,
	}
}

// NewChunkerWithMapper creates a chunker with an existing mapper (for shared ID space).
func NewChunkerWithMapper(chunkSize, overlap int, separators []string, outputWithoutNewline, debug bool, mapper *ChunkIDMapper) *Chunker {
	c := NewChunker(chunkSize, overlap, separators, outputWithoutNewline, debug)
	if mapper != nil {
		c.Mapper = mapper
	}
	return c
}

// Chunk (legacy): returns leaf texts only.
func (c *Chunker) Chunk(data string) []string {
	tree, _ := c.ChunkDocument("", data)
	out := make([]string, 0, len(tree.Leaves))
	for _, ch := range tree.Leaves {
		out = append(out, ch.Text)
	}
	return out
}

// DocumentChunker is the common interface for all chunking strategies.
type DocumentChunker interface {
	ChunkDocument(docID, data string) (ChunkTree, error)
}

// Ensure Chunker implements DocumentChunker
var _ DocumentChunker = (*Chunker)(nil)

// ChunkDocument splits a document into hierarchical chunks with uint32 IDs.
func (c *Chunker) ChunkDocument(docID, data string) (ChunkTree, error) {
	c.leaves = c.leaves[:0]
	c.parents = c.parents[:0]

	sentences := SplitSentencesWithSpans(data, defaultAbbreviations)
	if len(sentences) == 0 {
		return ChunkTree{Leaves: nil, Parents: nil}, nil
	}

	leaves := c.buildLeafChunks(docID, data, sentences)
	parents := c.buildParentChunks(docID, leaves)

	c.leaves = leaves
	c.parents = parents
	return ChunkTree{Leaves: leaves, Parents: parents}, nil
}

// SplitSentencesWithSpans splits into sentence spans with [Start,End) offsets.
func SplitSentencesWithSpans(data string, abbreviations []string) []SentenceSpan {
	if len(data) == 0 {
		return nil
	}
	if len(abbreviations) == 0 {
		abbreviations = defaultAbbreviations
	}

	indexes := sentBoundaryRe.FindAllStringIndex(data, -1)

	out := make([]SentenceSpan, 0, len(indexes)+1)
	start := 0

	for _, match := range indexes {
		rawEnd := match[0] + 1
		if rawEnd <= start {
			continue
		}

		s, e := trimSpan(data, start, rawEnd)
		if e <= s {
			start = match[1]
			continue
		}

		text := data[s:e]
		if endsWithAbbreviation(text, abbreviations) {
			continue
		}

		out = append(out, SentenceSpan{Start: s, End: e, Text: strings.TrimSpace(text)})
		start = match[1]
	}

	// Remaining tail.
	if start < len(data) {
		s, e := trimSpan(data, start, len(data))
		if e > s {
			text := data[s:e]
			out = append(out, SentenceSpan{Start: s, End: e, Text: strings.TrimSpace(text)})
		}
	}

	// Final cleanup: drop empties.
	j := 0
	for _, ss := range out {
		if len(ss.Text) == 0 || ss.End <= ss.Start {
			continue
		}
		out[j] = ss
		j++
	}
	return out[:j]
}

func endsWithAbbreviation(text string, abbreviations []string) bool {
	trimmed := strings.TrimSpace(text)
	for _, abbr := range abbreviations {
		if strings.HasSuffix(trimmed, abbr) {
			return true
		}
	}
	return false
}

func trimSpan(data string, start, end int) (int, int) {
	if start < 0 {
		start = 0
	}
	if end > len(data) {
		end = len(data)
	}
	for start < end {
		r := data[start]
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' || r == '\f' || r == '\v' {
			start++
			continue
		}
		break
	}
	for end > start {
		r := data[end-1]
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' || r == '\f' || r == '\v' {
			end--
			continue
		}
		break
	}
	return start, end
}

// chunkKey generates a unique key for a chunk.
func chunkKey(docID string, level uint8, start, end int) string {
	// Format: "docID:L{level}:{start}:{end}"
	var b strings.Builder
	b.Grow(len(docID) + 20)
	b.WriteString(docID)
	b.WriteByte(':')
	b.WriteByte('L')
	b.WriteByte('0' + level)
	b.WriteByte(':')
	b.WriteString(intToStr(start))
	b.WriteByte(':')
	b.WriteString(intToStr(end))
	return b.String()
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func (c *Chunker) buildLeafChunks(docID, _ string, sentences []SentenceSpan) []Chunk {
	if c.ChunkSize <= 0 {
		c.ChunkSize = 150
	}
	if c.Overlap < 0 {
		c.Overlap = 0
	}
	if c.Overlap >= c.ChunkSize {
		c.Overlap = c.ChunkSize / 4
	}

	var chunks []Chunk
	cur := make([]SentenceSpan, 0, 16)
	curLen := 0

	emit := func() {
		if len(cur) == 0 {
			return
		}
		start := cur[0].Start
		end := cur[len(cur)-1].End

		text := joinSentenceTexts(cur)
		text = strings.TrimSpace(text)
		if c.OutputWithoutNewline {
			text = removeNewlines(text)
		}
		if len(text) == 0 {
			return
		}

		// Generate key and get uint32 ID from mapper
		key := chunkKey(docID, 0, start, end)
		id := c.Mapper.GetOrAssign(key, docID)

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

			// Retain tail sentences whose total length <= Overlap.
			overlapLen := 0
			startIndex := len(cur)
			for j := len(cur) - 1; j >= 0; j-- {
				l := spanLenApprox(cur[j])
				if overlapLen+l > c.Overlap {
					break
				}
				overlapLen += l
				startIndex = j
			}
			if startIndex < len(cur) {
				cur = cur[startIndex:]
				curLen = overlapLen
			} else {
				cur = cur[:0]
				curLen = 0
			}

			// Hard progress guarantee: if a single sentence is huge, allow it alone.
			if len(cur) == 0 && sLen > c.ChunkSize {
				cur = append(cur, s)
				curLen = sLen
				emit()
				cur = cur[:0]
				curLen = 0
				continue
			}
		}

		cur = append(cur, s)
		curLen += sLen
	}

	emit()
	return chunks
}

func (c *Chunker) buildParentChunks(docID string, leaves []Chunk) []Chunk {
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

	var parents []Chunk
	cur := make([]Chunk, 0, 8)
	curLen := 0

	emit := func() {
		if len(cur) == 0 {
			return
		}
		start := cur[0].Start
		end := cur[len(cur)-1].End

		childIDs := make([]uint32, 0, len(cur))
		var b strings.Builder
		for i := range cur {
			childIDs = append(childIDs, cur[i].ID)
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(cur[i].Text)
		}

		text := strings.TrimSpace(b.String())
		if c.OutputWithoutNewline {
			text = removeNewlines(text)
		}
		if len(text) == 0 {
			return
		}

		// Generate key and get uint32 ID from mapper
		key := chunkKey(docID, 1, start, end)
		parentID := c.Mapper.GetOrAssign(key, docID)
		pIdx := len(parents)

		parents = append(parents, Chunk{
			ID:       parentID,
			DocID:    docID,
			Level:    1,
			Index:    pIdx,
			Start:    start,
			End:      end,
			Text:     text,
			ChildIDs: childIDs,
		})

		// Backfill ParentID on leaves we included.
		childSet := make(map[uint32]struct{}, len(childIDs))
		for _, id := range childIDs {
			childSet[id] = struct{}{}
		}
		for i := range leaves {
			if _, ok := childSet[leaves[i].ID]; ok {
				leaves[i].ParentID = parentID
			}
		}
	}

	for i := 0; i < len(leaves); i++ {
		leaf := leaves[i]
		l := len(leaf.Text) + 1

		if curLen > 0 && curLen+l > c.ParentChunkSize {
			emit()

			// Retain tail leaves whose total length <= ParentOverlap.
			overlapLen := 0
			startIndex := len(cur)
			for j := len(cur) - 1; j >= 0; j-- {
				ll := len(cur[j].Text) + 1
				if overlapLen+ll > c.ParentOverlap {
					break
				}
				overlapLen += ll
				startIndex = j
			}
			if startIndex < len(cur) {
				cur = cur[startIndex:]
				curLen = overlapLen
			} else {
				cur = cur[:0]
				curLen = 0
			}

			// Progress guarantee: if one leaf is huge, allow parent-of-one.
			if len(cur) == 0 && l > c.ParentChunkSize {
				cur = append(cur, leaf)
				curLen = l
				emit()
				cur = cur[:0]
				curLen = 0
				continue
			}
		}

		cur = append(cur, leaf)
		curLen += l
	}

	emit()
	return parents
}

func joinSentenceTexts(ss []SentenceSpan) string {
	if len(ss) == 0 {
		return ""
	}
	var b strings.Builder
	for i := range ss {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(strings.TrimSpace(ss[i].Text))
	}
	return b.String()
}

func spanLenApprox(s SentenceSpan) int {
	return len(s.Text) + 1
}

func removeNewlines(s string) string {
	if len(s) == 0 {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\u2028' || r == '\u2029' {
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		if unicode.IsSpace(r) {
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}
