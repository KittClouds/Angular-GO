package fullsystemindex

import (
	"github.com/kittclouds/gokitt/pkg/gldr"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// GLDRConfig is the cycle-safe config surface used by the full-system session.
type GLDRConfig struct {
	Alpha            float64 `json:"alpha,omitempty"`
	Beta             float64 `json:"beta,omitempty"`
	MaxGraphHops     int     `json:"maxGraphHops,omitempty"`
	SoftAnchorChunks int     `json:"softAnchorChunks,omitempty"`
	TopChunks        int     `json:"topChunks,omitempty"`
	TopNodes         int     `json:"topNodes,omitempty"`
	Lambda           float64 `json:"lambda,omitempty"`
	PPRDamping       float64 `json:"pprDamping,omitempty"`
	PPRIterations    int     `json:"pprIterations,omitempty"`
	SemanticTopK     int     `json:"semanticTopK,omitempty"`
	SemanticAlpha    float64 `json:"semanticAlpha,omitempty"`
	SemanticGamma    float64 `json:"semanticGamma,omitempty"`
}

// Mention is the cycle-safe mention surface used by the full-system session.
type Mention struct {
	EntityID   string  `json:"entityId"`
	Confidence float64 `json:"confidence"`
	Start      int     `json:"start"`
	End        int     `json:"end"`
}

// GraphEdge is the cycle-safe graph edge surface used by the full-system session.
type GraphEdge struct {
	SourceID   string  `json:"sourceId"`
	TargetID   string  `json:"targetId"`
	RelType    string  `json:"relType"`
	Confidence float64 `json:"confidence"`
	Source     string  `json:"source"`
}

// EntityMatch explains why an entity contributed to a GLDR chunk hit.
type EntityMatch struct {
	EntityID     string  `json:"entityId"`
	Proximity    float64 `json:"proximity"`
	MentionCount int     `json:"mentionCount"`
}

// ChunkResult is the cycle-safe GLDR chunk result shape.
type ChunkResult struct {
	ChunkID         string        `json:"chunkId"`
	ChunkScore      float64       `json:"chunkScore"`
	LexScore        float64       `json:"lexScore"`
	GraphScore      float64       `json:"graphScore"`
	SemanticScore   float64       `json:"semanticScore"`
	MatchedEntities []EntityMatch `json:"matchedEntities,omitempty"`
}

// NodeResult is the cycle-safe GLDR node result shape.
type NodeResult struct {
	EntityID           string   `json:"entityId"`
	NodeScore          float64  `json:"nodeScore"`
	TopChunks          []string `json:"topChunks,omitempty"`
	ProximityFromQuery float64  `json:"proximityFromQuery"`
}

// Stats summarizes the wrapped GLDR engine state.
type Stats struct {
	Chunks   int `json:"chunks"`
	Entities int `json:"entities"`
	Edges    int `json:"edges"`
}

// Engine is a cycle-safe wrapper around GLDR.
type Engine struct {
	idx *gldr.GLDRIndex
}

// DefaultGLDRConfig exposes the wrapped default config.
func DefaultGLDRConfig() GLDRConfig {
	cfg := gldr.DefaultGLDRConfig()
	return GLDRConfig{
		Alpha:            cfg.Alpha,
		Beta:             cfg.Beta,
		MaxGraphHops:     cfg.MaxGraphHops,
		SoftAnchorChunks: cfg.SoftAnchorChunks,
		TopChunks:        cfg.TopChunks,
		TopNodes:         cfg.TopNodes,
		Lambda:           cfg.Lambda,
		PPRDamping:       cfg.PPRDamping,
		PPRIterations:    cfg.PPRIterations,
		SemanticTopK:     cfg.SemanticTopK,
		SemanticAlpha:    cfg.SemanticAlpha,
		SemanticGamma:    cfg.SemanticGamma,
	}
}

// NewGLDREngine constructs a wrapped GLDR engine.
func NewGLDREngine(config GLDRConfig) *Engine {
	cfg := gldr.DefaultGLDRConfig()
	if config.Alpha > 0 {
		cfg.Alpha = config.Alpha
	}
	if config.Beta > 0 {
		cfg.Beta = config.Beta
	}
	if config.MaxGraphHops > 0 {
		cfg.MaxGraphHops = config.MaxGraphHops
	}
	if config.SoftAnchorChunks > 0 {
		cfg.SoftAnchorChunks = config.SoftAnchorChunks
	}
	if config.TopChunks > 0 {
		cfg.TopChunks = config.TopChunks
	}
	if config.TopNodes > 0 {
		cfg.TopNodes = config.TopNodes
	}
	if config.Lambda > 0 {
		cfg.Lambda = config.Lambda
	}
	if config.PPRDamping > 0 {
		cfg.PPRDamping = config.PPRDamping
	}
	if config.PPRIterations > 0 {
		cfg.PPRIterations = config.PPRIterations
	}
	if config.SemanticTopK > 0 {
		cfg.SemanticTopK = config.SemanticTopK
	}
	if config.SemanticAlpha > 0 {
		cfg.SemanticAlpha = config.SemanticAlpha
	}
	if config.SemanticGamma > 0 {
		cfg.SemanticGamma = config.SemanticGamma
	}

	return &Engine{idx: gldr.NewGLDR(cfg)}
}

// RegisterEntity adds a canonical name or alias mapping for anchor resolution.
func (e *Engine) RegisterEntity(name, entityID string) {
	e.idx.RegisterEntity(name, entityID)
}

// IndexChunk indexes one chunk and its entity mentions.
func (e *Engine) IndexChunk(chunkID string, fields map[string]string, mentions []Mention) {
	gldrMentions := make([]gldr.EntityMention, len(mentions))
	for i, mention := range mentions {
		gldrMentions[i] = gldr.EntityMention{
			EntityID:   mention.EntityID,
			Confidence: mention.Confidence,
			Start:      mention.Start,
			End:        mention.End,
		}
	}
	e.idx.IndexChunk(chunkID, fields, gldrMentions)
}

// AddGraphEdge inserts one directed graph edge.
func (e *Engine) AddGraphEdge(edge GraphEdge) {
	e.idx.AddGraphEdge(edge.SourceID, gldr.GraphEdge{
		TargetID:   edge.TargetID,
		RelType:    edge.RelType,
		Confidence: edge.Confidence,
		Source:     edge.Source,
	})
}

// AddBidirectionalEdge inserts a bidirectional graph relationship.
func (e *Engine) AddBidirectionalEdge(sourceID, targetID, relType string, confidence float64, source string) {
	e.idx.AddGraphEdgeBidirectional(sourceID, targetID, relType, confidence, source)
}

// Search returns chunk-level GLDR results.
func (e *Engine) Search(query string, limit int, scope *qgram.SearchScope) []ChunkResult {
	cfg := e.idx.Config
	if limit > 0 {
		cfg.TopChunks = limit
	}
	cfg.LexicalConfig.Scope = scope

	results := e.idx.Search(query, cfg)
	out := make([]ChunkResult, len(results))
	for i, result := range results {
		matches := make([]EntityMatch, len(result.MatchedEntities))
		for j, match := range result.MatchedEntities {
			matches[j] = EntityMatch{
				EntityID:     match.EntityID,
				Proximity:    match.Proximity,
				MentionCount: match.MentionCount,
			}
		}

		out[i] = ChunkResult{
			ChunkID:         result.ChunkID,
			ChunkScore:      result.ChunkScore,
			LexScore:        result.LexScore,
			GraphScore:      result.GraphScore,
			SemanticScore:   result.SemanticScore,
			MatchedEntities: matches,
		}
	}
	return out
}

// SearchNodes returns node-level GLDR results.
func (e *Engine) SearchNodes(query string, limit int, scope *qgram.SearchScope) []NodeResult {
	cfg := e.idx.Config
	if limit > 0 {
		cfg.TopNodes = limit
	}
	cfg.LexicalConfig.Scope = scope

	results := e.idx.SearchNodes(query, cfg)
	out := make([]NodeResult, len(results))
	for i, result := range results {
		out[i] = NodeResult{
			EntityID:           result.EntityID,
			NodeScore:          result.NodeScore,
			TopChunks:          append([]string{}, result.TopChunks...),
			ProximityFromQuery: result.ProximityFromQuery,
		}
	}
	return out
}

// Stats returns wrapped GLDR engine stats.
func (e *Engine) Stats() Stats {
	return Stats{
		Chunks:   e.idx.Len(),
		Entities: e.idx.GetEntityCount(),
		Edges:    e.idx.GetEdgeCount(),
	}
}
