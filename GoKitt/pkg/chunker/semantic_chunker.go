package chunker

import (
	"errors"
	"math"
	"strings"
)

// Embedder defines the interface for obtaining text embeddings.
// Implementations should be thread-safe if used concurrently.
type Embedder interface {
	EmbedBatch(texts []string) ([][]float32, error)
}

// SemanticChunker splits documents into hierarchical chunks using semantic boundaries.
type SemanticChunker struct {
	// Constraints
	MinChunkSize int // Minimum characters per chunk (hard floor)
	MaxChunkSize int // Maximum characters per chunk (soft cap)
	Overlap      int // Characters of overlap between chunks

	// Semantic parameters
	Embedder            Embedder
	SimilarityThreshold float64 // If 0, uses local minima detection
	WindowSize          int     // Number of sentences to group for embedding (e.g. 1 or 3)

	// ID management
	Mapper *ChunkIDMapper
}

// NewSemanticChunker creates a new semantic chunker.
func NewSemanticChunker(embedder Embedder, minSize, maxSize, overlap int) *SemanticChunker {
	if minSize <= 0 {
		minSize = 100
	}
	if maxSize <= 0 {
		maxSize = 1000
	}
	if overlap < 0 {
		overlap = 0
	}

	return &SemanticChunker{
		Embedder:     embedder,
		MinChunkSize: minSize,
		MaxChunkSize: maxSize,
		Overlap:      overlap,
		WindowSize:   1, // Default to single-sentence granularity
		Mapper:       NewChunkIDMapper(),
	}
}

// NewSemanticChunkerWithMapper creates a chunker sharing an ID mapper.
func NewSemanticChunkerWithMapper(embedder Embedder, minSize, maxSize, overlap int, mapper *ChunkIDMapper) *SemanticChunker {
	c := NewSemanticChunker(embedder, minSize, maxSize, overlap)
	if mapper != nil {
		c.Mapper = mapper
	}
	return c
}

// SegmentSpan represents a text segment with offsets.
type SegmentSpan struct {
	Text  string
	Start int
	End   int
}

// GetEmbeddableSpans returns segments with their start/end offsets.
func (c *SemanticChunker) GetEmbeddableSpans(text string) ([]SegmentSpan, error) {
	if len(text) == 0 {
		return nil, nil
	}

	atomicBlocks := c.splitAtomicBlocks(text)
	var spans []SegmentSpan

	for _, block := range atomicBlocks {
		if len(block.Text) > c.MaxChunkSize {
			sentences := SplitSentencesWithSpans(block.Text, defaultAbbreviations)
			for _, s := range sentences {
				spans = append(spans, SegmentSpan{
					Text:  s.Text,
					Start: block.Start + s.Start,
					End:   block.Start + s.End,
				})
			}
		} else {
			spans = append(spans, SegmentSpan{
				Text:  block.Text,
				Start: block.Start,
				End:   block.End,
			})
		}
	}
	return spans, nil
}

// GetEmbeddableSegments returns the text segments only.
func (c *SemanticChunker) GetEmbeddableSegments(text string) ([]string, error) {
	spans, err := c.GetEmbeddableSpans(text)
	if err != nil {
		return nil, err
	}
	segments := make([]string, len(spans))
	for i, s := range spans {
		segments[i] = s.Text
	}
	return segments, nil
}

// ChunkDocument performs semantic chunking on the document.
func (c *SemanticChunker) ChunkDocument(docID, text string) (ChunkTree, error) {
	if len(text) == 0 {
		return ChunkTree{}, nil
	}

	// 1. Structure-First Splitting
	// Identify atomic blocks (paragraphs, headers, code blocks) that we shouldn't split internally unless huge.
	atomicBlocks := c.splitAtomicBlocks(text)

	// 2. Refine Blocks & Embed
	// If blocks are too massive, split them by sentence.
	// Prepare text segments for embedding.
	var processingUnits []processingUnit
	for _, block := range atomicBlocks {
		if len(block.Text) > c.MaxChunkSize {
			// recursively breakdown large blocks by sentence
			sentences := SplitSentencesWithSpans(block.Text, defaultAbbreviations)
			for _, s := range sentences {
				// Offset adjustment needed because SplitSentences returns relative offsets to block.Text?
				// Actually SplitSentences works on string input.
				// However, if we pass the whole doc substring, we get correct offsets relative to that substring.
				// We need absolute offsets.
				unit := processingUnit{
					Start: block.Start + s.Start,
					End:   block.Start + s.End,
					Text:  s.Text,
					IsNew: false, // Sentences within a block flow together
				}
				processingUnits = append(processingUnits, unit)
			}
			// Mark the start of a new atomic block (the next one) as a potential hard boundary
			if len(processingUnits) > 0 {
				processingUnits[len(processingUnits)-1].IsNew = true
			}
		} else {
			// Small enough to treat as atomic
			processingUnits = append(processingUnits, processingUnit{
				Start: block.Start,
				End:   block.End,
				Text:  block.Text,
				IsNew: true, // It's a structure implementation, favor boundary here
			})
		}
	}

	if len(processingUnits) == 0 {
		return ChunkTree{}, nil
	}

	// 3. Compute Embeddings
	textsToEmbed := make([]string, len(processingUnits))
	for i, unit := range processingUnits {
		textsToEmbed[i] = unit.Text
	}

	embeddings, err := c.Embedder.EmbedBatch(textsToEmbed)
	if err != nil {
		return ChunkTree{}, err
	}
	if len(embeddings) != len(processingUnits) {
		return ChunkTree{}, errors.New("embedding count mismatch")
	}

	// 4. Calculate Similarity & Locate Boundaries
	// similarities[i] is similarity between unit[i] and unit[i+1]
	similarities := make([]float64, len(processingUnits)-1)
	for i := 0; i < len(processingUnits)-1; i++ {
		sim := cosineSimilarity(embeddings[i], embeddings[i+1])
		similarities[i] = sim
	}

	// 5. Pack into Chunks
	leaves := c.packChunks(docID, processingUnits, similarities)

	// 6. Build Parents (Simple hierarchy for now, or could use recursive semantic)
	// For now, reusing the simple size-based parent grouping from the regex chunker
	// might be inconsistent semantic-wise. Let's just create a single level of leaves for now.
	// The interface returns ChunkTree, so we can return empty parents or implement simple parents.
	// Let's implement simple parents by grouping leaves.

	parents := c.buildParentChunks(docID, leaves)

	return ChunkTree{
		Leaves:  leaves,
		Parents: parents,
	}, nil
}

// processingUnit represents an atomic text span (sentence or small block)
type processingUnit struct {
	Start int
	End   int
	Text  string
	IsNew bool // True if this starts a new structural block (strong signal for boundary)
}

type atomicBlock struct {
	Start int
	End   int
	Text  string
}

// splitAtomicBlocks splits mainly on double newlines and structural boundaries.
func (c *SemanticChunker) splitAtomicBlocks(text string) []atomicBlock {
	// A robust implementation would parse Markdown.
	// For now, we split on \n\n+ which indicates paragraph breaks.
	// We also respect code blocks if possible, but regex split is simplest for baseline.

	// Use the existing logic or simple split?
	// Let's iterate manually to track offsets.
	var blocks []atomicBlock
	start := 0
	length := len(text)

	// We'll scan for \n\n
	// simpler: loop through ranges
	for start < length {
		// Consumes distinct paragraphs
		// Find next double newline

		// Scan ...
		// Optimization: usage of regex or standard strings.Index
		// double newline
		idx := strings.Index(text[start:], "\n\n")
		if idx == -1 {
			// Rest of text
			end := length
			if end > start {
				blocks = append(blocks, atomicBlock{
					Start: start,
					End:   end,
					Text:  strings.TrimSpace(text[start:end]),
				})
			}
			break
		}

		absIdx := start + idx
		// The content is [start, absIdx)
		if absIdx > start {
			blocks = append(blocks, atomicBlock{
				Start: start,
				End:   absIdx,
				Text:  strings.TrimSpace(text[start:absIdx]),
			})
		}

		// Advance start past the newlines
		start = absIdx
		for start < length && (text[start] == '\n' || text[start] == '\r' || text[start] == ' ') {
			start++
		}
	}

	// Filter empty blocks
	validBlocks := blocks[:0]
	for _, b := range blocks {
		if len(b.Text) > 0 {
			validBlocks = append(validBlocks, b)
		}
	}

	return validBlocks
}

func (c *SemanticChunker) packChunks(docID string, units []processingUnit, sims []float64) []Chunk {
	var chunks []Chunk

	currentUnits := []processingUnit{units[0]}
	currentLen := len(units[0].Text)

	for i := 0; i < len(sims); i++ {
		// Next unit is units[i+1]
		nextUnit := units[i+1]
		sim := sims[i]

		// Decide to split or merge
		// Split if:
		// 1. Current chunk is getting too big (> MaxChunkSize)
		// 2. OR (Current chunk > MinChunkSize AND Similarity is low (Topic Shift))
		// 3. OR (Current chunk > MinChunkSize AND structural break (IsNew))

		// Detection of local minima could be added here (check if sim[i] < sim[i-1] and sim[i] < sim[i+1])
		// For robustness, let's use a percentile or absolute threshold if provided.
		// If threshold is 0, we can use a dynamic heuristic: e.g. < 0.5 or local dip.
		isTopicShift := false
		if c.SimilarityThreshold > 0 {
			isTopicShift = sim < c.SimilarityThreshold
		} else {
			// Simple dynamic check: drop below 0.6 is usually a shift in sentence-level embedding
			isTopicShift = sim < 0.6
		}

		forcedSplit := currentLen+len(nextUnit.Text) > c.MaxChunkSize
		structuralSplit := nextUnit.IsNew && currentLen >= c.MinChunkSize
		semanticSplit := isTopicShift && currentLen >= c.MinChunkSize

		if forcedSplit || structuralSplit || semanticSplit {
			// EMIT CHUNK
			c.emitChunk(&chunks, docID, currentUnits)

			// Handle Overlap for the next chunk
			// We want to pull back some units from the end of current chunk
			// such that their length is roughly c.Overlap
			startUnits := c.getOverlapUnits(currentUnits)

			currentUnits = append(startUnits, nextUnit)
			currentLen = 0
			for _, u := range currentUnits {
				currentLen += len(u.Text)
			}
		} else {
			// MERGE
			currentUnits = append(currentUnits, nextUnit)
			currentLen += len(nextUnit.Text)
		}
	}

	// Final chunk
	if len(currentUnits) > 0 {
		c.emitChunk(&chunks, docID, currentUnits)
	}

	return chunks
}

func (c *SemanticChunker) getOverlapUnits(units []processingUnit) []processingUnit {
	if c.Overlap <= 0 || len(units) == 0 {
		return nil
	}

	wanted := c.Overlap
	accum := 0
	idx := len(units)

	// Scan from back
	for i := len(units) - 1; i >= 0; i-- {
		accum += len(units[i].Text)
		idx = i
		if accum >= wanted {
			break
		}
	}

	// Optimization: Don't overlap more than 50% of the previous chunk if it's small?
	// For now, respect overlap char count.
	return append([]processingUnit(nil), units[idx:]...)
}

func (c *SemanticChunker) emitChunk(chunks *[]Chunk, docID string, units []processingUnit) {
	if len(units) == 0 {
		return
	}

	start := units[0].Start
	end := units[len(units)-1].End

	// Join text
	var b strings.Builder
	for i, u := range units {
		if i > 0 {
			b.WriteByte(' ') // sentences joined by space
		}
		b.WriteString(u.Text)
	}
	text := b.String()

	// Assign ID
	key := chunkKey(docID, 0, start, end)
	id := c.Mapper.GetOrAssign(key, docID)

	*chunks = append(*chunks, Chunk{
		ID:    id,
		DocID: docID,
		Level: 0,
		Index: len(*chunks),
		Start: start,
		End:   end,
		Text:  text,
	})
}

// buildParentChunks - Logic reused/adapted from Regex Chunker
// Or simpler: Just group leaves until size limit.
func (c *SemanticChunker) buildParentChunks(docID string, leaves []Chunk) []Chunk {
	// Simple aggregation: Approx 4x size
	parentSize := c.MaxChunkSize * 4
	parentOverlap := c.Overlap * 2 // Arbitrary

	var parents []Chunk
	curLeaves := make([]Chunk, 0)
	curLen := 0

	// Create lookup map for leaves to modify strict original
	leafMap := make(map[uint32]*Chunk, len(leaves))
	for i := range leaves {
		leafMap[leaves[i].ID] = &leaves[i]
	}

	emitParent := func() {
		if len(curLeaves) == 0 {
			return
		}

		start := curLeaves[0].Start
		end := curLeaves[len(curLeaves)-1].End

		childIDs := make([]uint32, len(curLeaves))
		var b strings.Builder
		for i, l := range curLeaves {
			childIDs[i] = l.ID
			if i > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(l.Text)
		}
		text := b.String()

		key := chunkKey(docID, 1, start, end)
		pid := c.Mapper.GetOrAssign(key, docID)

		parents = append(parents, Chunk{
			ID:       pid,
			DocID:    docID,
			Level:    1,
			Index:    len(parents),
			Start:    start,
			End:      end,
			Text:     text,
			ChildIDs: childIDs,
		})

		// Optimize Backfill using map (built once or outside)
		// Since iterating all leaves is O(N*M), let's use a lookup.
		// Actually, we can just use the leaf ID to find it if we index leaves.
		// For simplicity/correctness with the current loop:
		// We know curLeaves corresponds to a subset of 'leaves'.
		// But curLeaves contains copies.
		// Let's rely on the fact that we can index 'leaves' by ID if we build a map.

		for _, cid := range childIDs {
			if ptr, ok := leafMap[cid]; ok {
				ptr.ParentID = pid
			}
		}
	}

	for _, leaf := range leaves {
		lLen := len(leaf.Text)
		if curLen+lLen > parentSize && len(curLeaves) > 0 {
			emitParent()

			// Overlap logic for parents
			// Drop from front until overlap constraint met
			newCur := make([]Chunk, 0)
			newLen := 0
			// working backwards
			wanted := parentOverlap
			accum := 0
			startIdx := len(curLeaves)
			for j := len(curLeaves) - 1; j >= 0; j-- {
				accum += len(curLeaves[j].Text)
				startIdx = j
				if accum >= wanted {
					break
				}
			}
			newCur = append(newCur, curLeaves[startIdx:]...)
			for _, item := range newCur {
				newLen += len(item.Text)
			}
			curLeaves = newCur
			curLen = newLen
		}

		curLeaves = append(curLeaves, leaf)
		curLen += len(leaf.Text)
	}
	emitParent()

	return parents
}

func cosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}
	var dot, normA, normB float64
	for i := 0; i < len(a); i++ {
		dot += float64(a[i] * b[i])
		normA += float64(a[i] * a[i])
		normB += float64(b[i] * b[i])
	}
	if normA == 0 || normB == 0 {
		return 0.0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}
