package gldr

import (
	"sort"
	"strings"
	"sync"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/kittclouds/gokitt/pkg/graptor"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// GLDRIndex is the main retrieval index combining lexical and graph components.
type GLDRIndex struct {
	mu sync.RWMutex

	// Lexical index (wraps existing qgram)
	QGram *qgram.CompressedQGramIndex

	// Entity→Chunk mapping (roaring bitmap for fast intersection)
	EntityChunks map[string]*roaring.Bitmap // entity_id → chunk_ids

	// Chunk→Entity mapping (for scoring)
	ChunkEntities map[uint32][]EntityMention // chunk_id → mentions

	// Graph adjacency
	GraphAdj map[string][]GraphEdge // entity_id → outgoing edges

	// Entity name → ID registry (for anchor resolution)
	entityNames map[string]string // canonical_name → entity_id

	// Configuration
	Config GLDRConfig
}

// NewGLDR creates a new GLDR index with the given configuration.
func NewGLDR(config GLDRConfig) *GLDRIndex {
	return &GLDRIndex{
		QGram:         qgram.NewCompressedQGramIndex(3), // Q=3 trigrams
		EntityChunks:  make(map[string]*roaring.Bitmap),
		ChunkEntities: make(map[uint32][]EntityMention),
		GraphAdj:      make(map[string][]GraphEdge),
		entityNames:   make(map[string]string),
		Config:        config,
	}
}

// IndexChunk indexes a text chunk with its entity mentions.
func (idx *GLDRIndex) IndexChunk(chunkID string, fields map[string]string, mentions []EntityMention) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	// 1. Index in lexical index
	idx.QGram.IndexDocumentScoped(chunkID, fields, "", "")

	// 2. Get uint32 ID
	uid := idx.QGram.Mapper.GetOrAssign(chunkID)

	// 3. Store chunk→entity mapping
	idx.ChunkEntities[uid] = mentions

	// 4. Store entity→chunk mapping
	for _, m := range mentions {
		bm, ok := idx.EntityChunks[m.EntityID]
		if !ok {
			bm = roaring.New()
			idx.EntityChunks[m.EntityID] = bm
		}
		bm.Add(uid)
	}
}

// AddGraphEdge adds a directed edge in the entity graph.
func (idx *GLDRIndex) AddGraphEdge(sourceID string, edge GraphEdge) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	idx.GraphAdj[sourceID] = append(idx.GraphAdj[sourceID], edge)
}

// AddGraphEdgeBidirectional adds edges in both directions.
func (idx *GLDRIndex) AddGraphEdgeBidirectional(sourceID, targetID, relType string, confidence float64, source string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	idx.GraphAdj[sourceID] = append(idx.GraphAdj[sourceID], GraphEdge{
		TargetID:   targetID,
		RelType:    relType,
		Confidence: confidence,
		Source:     source,
	})
	idx.GraphAdj[targetID] = append(idx.GraphAdj[targetID], GraphEdge{
		TargetID:   sourceID,
		RelType:    relType,
		Confidence: confidence,
		Source:     source,
	})
}

// LoadCooccurrences bulk-loads graph edges from graptor CooccurrenceStats.
func (idx *GLDRIndex) LoadCooccurrences(cooc *graptor.CooccurrenceStats, minCount int) {
	pairs := cooc.GetAllPairs(minCount)

	idx.mu.Lock()
	defer idx.mu.Unlock()

	for _, pair := range pairs {
		confidence := float64(pair.Count)
		idx.GraphAdj[pair.Entity1ID] = append(idx.GraphAdj[pair.Entity1ID], GraphEdge{
			TargetID:   pair.Entity2ID,
			RelType:    "cooccurs",
			Confidence: confidence,
			Source:     "cooccurrence",
		})
		idx.GraphAdj[pair.Entity2ID] = append(idx.GraphAdj[pair.Entity2ID], GraphEdge{
			TargetID:   pair.Entity1ID,
			RelType:    "cooccurs",
			Confidence: confidence,
			Source:     "cooccurrence",
		})
	}
}

// RegisterEntity registers an entity name → ID mapping for anchor resolution.
func (idx *GLDRIndex) RegisterEntity(name, entityID string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	canonical := strings.ToLower(strings.TrimSpace(name))
	idx.entityNames[canonical] = entityID
}

// Delete removes a chunk from the index.
func (idx *GLDRIndex) Delete(chunkID string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	uid := idx.QGram.Mapper.Get(chunkID)

	// Remove entity→chunk mappings
	mentions := idx.ChunkEntities[uid]
	for _, m := range mentions {
		if bm, ok := idx.EntityChunks[m.EntityID]; ok {
			bm.Remove(uid)
			if bm.IsEmpty() {
				delete(idx.EntityChunks, m.EntityID)
			}
		}
	}

	// Clear chunk→entity mapping
	idx.ChunkEntities[uid] = nil

	// Lazy delete from lexical index
	idx.QGram.LazyDelete(chunkID)
}

// Search executes the full GLDR pipeline.
// 1. Anchor entities from query
// 2. Compute graph proximity from anchors
// 3. Generate lexical candidates
// 4. Fuse lexical + graph scores
func (idx *GLDRIndex) Search(query string, config GLDRConfig) []GLDRResult {
	if query == "" {
		return nil
	}

	idx.mu.RLock()
	defer idx.mu.RUnlock()

	// 1. Parse and anchor
	gldrQuery := idx.anchorEntities(query)
	if len(gldrQuery.Clauses) == 0 {
		return nil
	}

	// 2. Get lexical candidates and scores
	lexResults := idx.QGram.Search(query, config.LexicalConfig, config.TopChunks*2)
	if len(lexResults) == 0 {
		return nil
	}

	// Build candidate set and lex score map
	candidates := make([]uint32, 0, len(lexResults))
	lexScores := make(map[uint32]float64, len(lexResults))
	for _, r := range lexResults {
		uid := idx.QGram.Mapper.Get(r.DocID)
		if uid == 0 {
			continue
		}
		candidates = append(candidates, uid)
		lexScores[uid] = r.Score
	}

	// 3. Expand candidates with entity chunks (graph-sourced candidates)
	allAnchors := gldrQuery.AllAnchors()
	for _, anchor := range allAnchors {
		if bm, ok := idx.EntityChunks[anchor.EntityID]; ok {
			it := bm.Iterator()
			for it.HasNext() {
				uid := it.Next()
				if _, exists := lexScores[uid]; !exists {
					candidates = append(candidates, uid)
					lexScores[uid] = 0 // No lex score, pure graph hit
				}
			}
		}
	}

	// 4. Compute graph proximity
	proximity := idx.ComputeProximity(allAnchors)

	// 5. Fused scoring
	results := idx.ScoreChunks(candidates, proximity, lexScores)

	// 6. Limit results
	if config.TopChunks > 0 && len(results) > config.TopChunks {
		results = results[:config.TopChunks]
	}

	return results
}

// SearchNodes executes GLDR and returns entity-level ranked results.
func (idx *GLDRIndex) SearchNodes(query string, config GLDRConfig) []NodeResult {
	chunkResults := idx.Search(query, config)
	if len(chunkResults) == 0 {
		return nil
	}

	idx.mu.RLock()
	defer idx.mu.RUnlock()

	gldrQuery := idx.anchorEntities(query)
	allAnchors := gldrQuery.AllAnchors()
	proximity := idx.ComputeProximity(allAnchors)

	return idx.RankNodes(chunkResults, proximity)
}

// Len returns the number of indexed chunks.
func (idx *GLDRIndex) Len() int {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	return int(idx.QGram.Mapper.NextID()) - 1
}

// anchorEntities extracts entity anchors from a query (must hold at least RLock).
func (idx *GLDRIndex) anchorEntities(query string) *GLDRQuery {
	result := &GLDRQuery{RawText: query}

	// 1. Parse lexical clauses
	result.Clauses = qgram.ParseQuery(query)

	// 2. Direct anchors: canonicalize each clause and lookup
	for _, clause := range result.Clauses {
		canonical := strings.ToLower(strings.TrimSpace(clause.Pattern))
		if entityID, ok := idx.entityNames[canonical]; ok {
			result.DirectAnchors = append(result.DirectAnchors, EntityAnchor{
				EntityID:   entityID,
				Confidence: 1.0,
				Source:     "direct",
			})
		}
	}

	// 3. Soft anchors: if no direct anchors, use lexical gate
	if len(result.DirectAnchors) == 0 {
		topChunks := idx.QGram.Search(query, idx.Config.LexicalConfig, idx.Config.SoftAnchorChunks)
		for i, chunk := range topChunks {
			uid := idx.QGram.Mapper.Get(chunk.DocID)
			mentions := idx.ChunkEntities[uid]
			for _, m := range mentions {
				confidence := m.Confidence
				if i > 0 && len(topChunks) > 0 && topChunks[0].Score > 0 {
					confidence *= chunk.Score / topChunks[0].Score
				}
				result.SoftAnchors = append(result.SoftAnchors, EntityAnchor{
					EntityID:   m.EntityID,
					Confidence: confidence,
					Source:     "soft",
				})
			}
		}
	}

	return result
}

// ScoreChunks computes fused scores for candidate chunks.
func (idx *GLDRIndex) ScoreChunks(
	candidates []uint32,
	proximity map[string]float64,
	lexScores map[uint32]float64,
) []GLDRResult {
	results := make([]GLDRResult, 0, len(candidates))

	// Normalize lexical scores
	maxLex := 0.0
	for _, s := range lexScores {
		if s > maxLex {
			maxLex = s
		}
	}

	// Find max graph contribution for normalization
	maxGraph := 0.0
	for _, chunkID := range candidates {
		graphScore := 0.0
		for _, m := range idx.ChunkEntities[chunkID] {
			if prox, ok := proximity[m.EntityID]; ok {
				graphScore += prox
			}
		}
		if graphScore > maxGraph {
			maxGraph = graphScore
		}
	}

	// Determine weights based on anchor presence
	alpha, beta := idx.Config.Alpha, idx.Config.Beta
	if len(proximity) == 0 {
		alpha, beta = 1.0, 0.0 // Pure lexical when no graph signal
	}

	for _, uid := range candidates {
		// Lexical component
		lexNorm := 0.0
		if maxLex > 0 {
			lexNorm = lexScores[uid] / maxLex
		}

		// Graph component: sum proximity of mentioned entities
		graphScore := 0.0
		var matchedEntities []EntityMatch
		for _, m := range idx.ChunkEntities[uid] {
			if prox, ok := proximity[m.EntityID]; ok {
				graphScore += prox
				matchedEntities = append(matchedEntities, EntityMatch{
					EntityID:     m.EntityID,
					Proximity:    prox,
					MentionCount: 1,
				})
			}
		}

		// Normalize graph score
		graphNorm := 0.0
		if maxGraph > 0 {
			graphNorm = graphScore / maxGraph
		}

		// Fused score
		fusedScore := alpha*lexNorm + beta*graphNorm

		docID := idx.QGram.Mapper.GetString(uid)
		if docID == "" {
			continue
		}

		results = append(results, GLDRResult{
			ChunkID:         docID,
			ChunkScore:      fusedScore,
			LexScore:        lexScores[uid],
			GraphScore:      graphScore,
			MatchedEntities: matchedEntities,
		})
	}

	// Sort by fused score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].ChunkScore > results[j].ChunkScore
	})

	return results
}

// RankNodes converts chunk scores to entity/node scores.
func (idx *GLDRIndex) RankNodes(
	chunkResults []GLDRResult,
	proximity map[string]float64,
) []NodeResult {
	// Aggregate chunk scores per entity
	entityChunkScores := make(map[string]float64)
	entityTopChunks := make(map[string][]string)

	for _, cr := range chunkResults {
		for _, m := range cr.MatchedEntities {
			if cr.ChunkScore > entityChunkScores[m.EntityID] {
				entityChunkScores[m.EntityID] = cr.ChunkScore
			}
			if len(entityTopChunks[m.EntityID]) < 3 {
				entityTopChunks[m.EntityID] = append(entityTopChunks[m.EntityID], cr.ChunkID)
			}
		}
	}

	// Compute node scores
	nodes := make([]NodeResult, 0, len(entityChunkScores))
	for entityID, maxScore := range entityChunkScores {
		prox := 0.0
		if p, ok := proximity[entityID]; ok {
			prox = p
		}

		nodeScore := maxScore + idx.Config.Lambda*prox

		nodes = append(nodes, NodeResult{
			EntityID:           entityID,
			NodeScore:          nodeScore,
			TopChunks:          entityTopChunks[entityID],
			ProximityFromQuery: prox,
		})
	}

	// Sort by node score descending
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].NodeScore > nodes[j].NodeScore
	})

	// Limit results
	if idx.Config.TopNodes > 0 && len(nodes) > idx.Config.TopNodes {
		nodes = nodes[:idx.Config.TopNodes]
	}

	return nodes
}
