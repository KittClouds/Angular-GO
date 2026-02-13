package qgram

type GramMetadata struct {
	FieldOccurrences map[string]FieldOccurrence
	SegmentMask      uint32
}

type FieldOccurrence struct {
	TF          int
	FieldLength int
}

type DocumentInfo struct {
	Fields      map[string]string // raw text for verification
	DocID       string
	NarrativeID string
	FolderPath  string
}

type CorpusStats struct {
	TotalDocuments      int
	AverageDocLength    float64
	AverageFieldLengths map[string]float64
}

type QGramIndex struct {
	Q            int
	GramPostings map[string]map[string]*GramMetadata // gram -> docID -> meta
	GramStats    map[string]*GramStat                // gram -> stats (for WAND pruning)
	Documents    map[string]DocumentInfo

	// Internal sums for calculating stats on the fly
	totalDocLen    float64
	totalFieldLens map[string]float64
	totalDocs      int
}

type GramStat struct {
	MaxTF       int
	MinFieldLen int
}

func NewQGramIndex(q int) *QGramIndex {
	return &QGramIndex{
		Q:              q,
		GramPostings:   make(map[string]map[string]*GramMetadata),
		GramStats:      make(map[string]*GramStat),
		Documents:      make(map[string]DocumentInfo),
		totalFieldLens: make(map[string]float64),
	}
}

// ExtractGrams returns all q-grams for testing/utils
func ExtractGrams(text string, q int) []string {
	if len(text) < q {
		return nil
	}
	grams := make([]string, 0, len(text)-q+1)
	for i := 0; i <= len(text)-q; i++ {
		grams = append(grams, text[i:i+q])
	}
	return grams
}

func (idx *QGramIndex) IndexDocument(docID string, fields map[string]string) {
	idx.IndexDocumentScoped(docID, fields, "", "")
}

func (idx *QGramIndex) IndexDocumentScoped(docID string, fields map[string]string, narrativeID, folderPath string) {
	idx.totalDocs++

	idx.Documents[docID] = DocumentInfo{
		Fields:      fields,
		DocID:       docID,
		NarrativeID: narrativeID,
		FolderPath:  folderPath,
	}

	docLen := 0

	for field, content := range fields {
		normalized := NormalizeText(content)
		fieldLen := len(normalized)

		idx.totalFieldLens[field] += float64(fieldLen)
		docLen += fieldLen

		if fieldLen < idx.Q {
			// Field too short for q-grams, cannot be found by q-gram search
			// unless we index shorter grams or special tokens.
			// Ignoring for now as per plan.
			continue
		}

		for i := 0; i <= fieldLen-idx.Q; i++ {
			gram := normalized[i : i+idx.Q]

			if idx.GramPostings[gram] == nil {
				idx.GramPostings[gram] = make(map[string]*GramMetadata)
			}

			meta, exists := idx.GramPostings[gram][docID]
			if !exists {
				meta = &GramMetadata{
					FieldOccurrences: make(map[string]FieldOccurrence),
				}
				idx.GramPostings[gram][docID] = meta
			}

			// Update TF
			occ := meta.FieldOccurrences[field]
			occ.TF++
			occ.FieldLength = fieldLen
			meta.FieldOccurrences[field] = occ

			// Update Segment Mask (0-31 based on position in field)
			// Avoid div by zero (checked by loop condition fieldLen >= Q >= 1 usually)
			segIdx := (i * 32) / fieldLen
			if segIdx >= 32 {
				segIdx = 31
			}
			meta.SegmentMask |= (1 << segIdx)

			// Phase 10: WAND Stats
			stat, ok := idx.GramStats[gram]
			if !ok {
				stat = &GramStat{MinFieldLen: fieldLen}
				idx.GramStats[gram] = stat
			}
			if occ.TF > stat.MaxTF {
				stat.MaxTF = occ.TF
			}
			if fieldLen < stat.MinFieldLen {
				stat.MinFieldLen = fieldLen
			}
		}
	}

	idx.totalDocLen += float64(docLen)
}

func (idx *QGramIndex) GetCorpusStats() CorpusStats {
	stats := CorpusStats{
		TotalDocuments:      idx.totalDocs,
		AverageFieldLengths: make(map[string]float64),
	}

	if idx.totalDocs > 0 {
		stats.AverageDocLength = idx.totalDocLen / float64(idx.totalDocs)
		for f, sum := range idx.totalFieldLens {
			stats.AverageFieldLengths[f] = sum / float64(idx.totalDocs)
		}
	}

	return stats
}

// RemoveDocument removes a document from the index.
// It decrements corpus stats and removes all gram postings for the docID.
func (idx *QGramIndex) RemoveDocument(docID string) {
	doc, exists := idx.Documents[docID]
	if !exists {
		return // Nothing to remove
	}

	// Calculate document length for stats adjustment
	docLen := 0
	for _, content := range doc.Fields {
		docLen += len(NormalizeText(content))
	}

	// Remove from gram postings
	for gram, postings := range idx.GramPostings {
		delete(postings, docID)
		// Clean up empty posting lists
		if len(postings) == 0 {
			delete(idx.GramPostings, gram)
		}
	}

	// Remove from documents map
	delete(idx.Documents, docID)

	// Adjust corpus stats
	idx.totalDocs--
	idx.totalDocLen -= float64(docLen)

	// Adjust field lengths
	for field, content := range doc.Fields {
		fieldLen := len(NormalizeText(content))
		idx.totalFieldLens[field] -= float64(fieldLen)
		// Clean up zero entries
		if idx.totalFieldLens[field] <= 0 {
			delete(idx.totalFieldLens, field)
		}
	}
}
