package resorank

// ResoRankConfig holds scoring parameters
type ResoRankConfig struct {
	K1                  float64               `json:"k1"`
	B                   float64               `json:"b"`
	ProximityAlpha      float64               `json:"proximityAlpha"`
	ProximityDecay      float64               `json:"proximityDecayLambda"`
	MaxSegments         uint32                `json:"maxSegments"`
	UseAdaptiveSegments bool                  `json:"useAdaptiveSegments"`
	FieldWeights        map[string]float64    `json:"fieldWeights"`
	FieldParams         map[string]FieldParam `json:"fieldParams"`
	VectorAlpha         float64               `json:"vectorAlpha"` // Weight for vector score (0-1)
}

type FieldParam struct {
	Weight float64 `json:"weight"`
	B      float64 `json:"b"` // Field-specific b
}

func DefaultConfig() ResoRankConfig {
	return ResoRankConfig{
		K1:             1.2,
		B:              0.75,
		ProximityAlpha: 0.5,
		ProximityDecay: 0.1,
		MaxSegments:    32,
		FieldWeights:   make(map[string]float64),
		FieldParams:    make(map[string]FieldParam),
		VectorAlpha:    0.0, // Default to pure BM25
	}
}

// TokenMetadata tracks term statistics
type TokenMetadata struct {
	FieldOccurrences map[string]FieldOccurrence `json:"fieldOccurrences"`
	SegmentMask      uint32                     `json:"segmentMask"`
	CorpusDocFreq    int                        `json:"corpusDocFrequency"`
}

// FieldOccurrence tracks term hits in a field
type FieldOccurrence struct {
	TF          int `json:"tf"`
	FieldLength int `json:"fieldLength"`
}

// DocumentMetadata tracks document structure
type DocumentMetadata struct {
	FieldLengths    map[string]int `json:"fieldLengths"`
	TotalTokenCount int            `json:"totalTokenCount"`
	Embedding       []float32      `json:"embedding,omitempty"` // for hybrid search
}

// SearchResult represents a scored match
type SearchResult struct {
	DocID string  `json:"docId"`
	Score float64 `json:"score"`
}

// CorpusStatistics tracks global stats
type CorpusStatistics struct {
	TotalDocuments      int                `json:"totalDocuments"`
	AverageDocLength    float64            `json:"averageDocumentLength"`
	AverageFieldLengths map[string]float64 `json:"averageFieldLengths"`
}
