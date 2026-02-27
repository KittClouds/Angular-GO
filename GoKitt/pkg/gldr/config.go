package gldr

import "github.com/kittclouds/gokitt/pkg/qgram"

// GLDRConfig holds all tuning parameters for GLDR search.
type GLDRConfig struct {
	// Lexical config (passed through to qgram)
	LexicalConfig qgram.SearchConfig

	// Fusion weights
	Alpha float64 // Lexical weight (default: 0.6)
	Beta  float64 // Graph weight (default: 0.4)

	// Graph proximity (GraphStore PersonalizedPageRank)
	MaxGraphHops  int     // Max BFS/PPR hop depth (default: 3)
	PPRDamping    float64 // Damping factor (default: 0.85)
	PPRIterations int     // Power iteration count (default: 20)

	// Anchor extraction
	SoftAnchorChunks int // Top-N chunks for soft anchors (default: 10)

	// Node ranking
	Lambda float64 // Proximity boost for node score (default: 0.3)

	// Result limits
	TopChunks int // Max chunks to return (default: 20)
	TopNodes  int // Max nodes to return (default: 10)
}

// DefaultGLDRConfig returns sane defaults for GLDR search.
func DefaultGLDRConfig() GLDRConfig {
	return GLDRConfig{
		LexicalConfig:    qgram.DefaultSearchConfig(),
		Alpha:            0.6,
		Beta:             0.4,
		MaxGraphHops:     3,
		PPRDamping:       0.85,
		PPRIterations:    20,
		SoftAnchorChunks: 10,
		Lambda:           0.3,
		TopChunks:        20,
		TopNodes:         10,
	}
}
