package gldr

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/RoaringBitmap/roaring/v2"
	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/kittclouds/gokitt/internal/graphstore"
	"github.com/kittclouds/gokitt/pkg/gdr"
	"github.com/kittclouds/gokitt/pkg/graptor"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// entityNS is the UUID namespace for deterministic entity → UUID mapping.
var entityNS = uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

// EntityUUID deterministically maps a string entity ID to a UUID.
func EntityUUID(entityID string) uuid.UUID {
	return uuid.NewSHA1(entityNS, []byte(entityID))
}

// GLDRIndex is the main retrieval index combining lexical and graph components.
type GLDRIndex struct {
	mu sync.RWMutex

	// Lexical index (wraps existing qgram)
	QGram *qgram.CompressedQGramIndex

	// Semantic sidecar (GDR lexical+vector retrieval)
	Semantic *gdr.GateDrivenRetriever

	// Entity→Chunk mapping (roaring bitmap for fast intersection)
	EntityChunks map[string]*roaring.Bitmap // entity_id → chunk_ids

	// Chunk→Entity mapping (for scoring)
	ChunkEntities map[uint32][]EntityMention // chunk_id → mentions

	// Graph store (SQLite-backed, in-memory cached)
	Store         *graphstore.SQLiteStore[string]
	MaxEdgeWeight float64 // Raw max co-occurrence count (before normalization)

	// Entity name → ID registry (for anchor resolution)
	entityNames map[string]string // canonical_name → entity_id

	// Configuration
	Config GLDRConfig
}

// NewGLDR creates a new GLDR index with the given configuration.
// Uses an in-memory SQLite database for the graph store.
func NewGLDR(config GLDRConfig) *GLDRIndex {
	db, err := graphstore.OpenDB("file::memory:?mode=memory&cache=shared")
	if err != nil {
		panic(fmt.Errorf("gldr: failed to open in-memory SQLite: %w", err))
	}
	return NewGLDRWithDB(config, db)
}

// NewGLDRWithDB creates a GLDR index backed by an existing database.
func NewGLDRWithDB(config GLDRConfig, db *sql.DB) *GLDRIndex {
	// Ensure schema exists
	if err := graphstore.Migrate(context.Background(), db); err != nil {
		panic(fmt.Errorf("gldr: failed to migrate graphstore schema: %w", err))
	}

	store := graphstore.NewJSON[string](db)
	return &GLDRIndex{
		QGram:         qgram.NewCompressedQGramIndex(3),
		Semantic:      gdr.NewGDR(config.SemanticConfig),
		EntityChunks:  make(map[string]*roaring.Bitmap),
		ChunkEntities: make(map[uint32][]EntityMention),
		Store:         store,
		entityNames:   make(map[string]string),
		Config:        config,
	}
}

// IndexChunk indexes a text chunk with its entity mentions.
func (idx *GLDRIndex) IndexChunk(chunkID string, fields map[string]string, mentions []EntityMention) {
	idx.IndexChunkWithVector(chunkID, fields, mentions, nil)
}

// IndexChunkWithVector indexes a text chunk with entity mentions and an optional semantic vector.
func (idx *GLDRIndex) IndexChunkWithVector(chunkID string, fields map[string]string, mentions []EntityMention, vec []float32) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	// 1. Index in lexical index
	idx.QGram.IndexDocumentScoped(chunkID, fields, "", "")
	if idx.Semantic != nil {
		_ = idx.Semantic.Upsert(chunkID, fields, vec)
	}

	// 2. Get uint32 ID
	uid := idx.QGram.Mapper.GetOrAssign(chunkID)

	// 3. Store chunk?entity mapping
	idx.ChunkEntities[uid] = mentions

	// 4. Store entity?chunk mapping
	for _, m := range mentions {
		bm, ok := idx.EntityChunks[m.EntityID]
		if !ok {
			bm = roaring.New()
			idx.EntityChunks[m.EntityID] = bm
		}
		bm.Add(uid)
	}
}

// ensureVertex ensures an entity exists as a vertex in the graph store.
// Returns the UUID for the entity. Does NOT hold idx.mu (caller must not hold).
func (idx *GLDRIndex) ensureVertex(entityID string) uuid.UUID {
	uid := EntityUUID(entityID)
	// AddVertex is idempotent — ignore ErrVertexAlreadyExists
	// entity_id is stored as the vertex value T (string), not in attrs
	_ = idx.Store.AddVertex(uid, entityID, graph.VertexProperties{})
	return uid
}

// AddGraphEdge adds a directed edge in the entity graph.
// If the edge has temporal markers (ValidFrom/ValidUntil), they are serialized to attributes.
func (idx *GLDRIndex) AddGraphEdge(sourceID string, edge GraphEdge) {
	srcUUID := idx.ensureVertex(sourceID)
	tgtUUID := idx.ensureVertex(edge.TargetID)

	attrs := map[string]string{
		"relType":    edge.RelType,
		"confidence": fmt.Sprintf("%f", edge.Confidence),
		"source":     edge.Source,
	}

	// Serialize temporal markers if present
	serializeTemporalToAttrs(attrs, edge.ValidFrom, "valid_from")
	serializeTemporalToAttrs(attrs, edge.ValidUntil, "valid_until")

	_ = idx.Store.AddEdge(srcUUID, tgtUUID, graph.Edge[uuid.UUID]{
		Source: srcUUID,
		Target: tgtUUID,
		Properties: graph.EdgeProperties{
			Attributes: attrs,
		},
	})
}

// AddGraphEdgeWithTemporal adds an edge with explicit temporal markers.
// This is a convenience method for creating time-bounded edges.
func (idx *GLDRIndex) AddGraphEdgeWithTemporal(sourceID string, edge GraphEdge, validFrom, validUntil *TemporalMarker) {
	edge.ValidFrom = validFrom
	edge.ValidUntil = validUntil
	idx.AddGraphEdge(sourceID, edge)
}

// serializeTemporalToAttrs serializes a TemporalMarker to edge attributes with a given prefix.
func serializeTemporalToAttrs(attrs map[string]string, marker *TemporalMarker, prefix string) {
	if marker == nil || marker.IsZero() {
		return
	}

	attrs[prefix+"_source"] = string(marker.Source)

	switch marker.Source {
	case TemporalSourceChapter:
		if marker.Chapter != nil {
			attrs[prefix+"_chapter"] = strconv.FormatUint(uint64(*marker.Chapter), 10)
		}
	case TemporalSourceCalendar:
		if marker.Calendar != nil {
			attrs[prefix+"_calendar"] = strconv.FormatInt(*marker.Calendar, 10)
		}
	case TemporalSourceStory:
		if marker.StoryTime != nil {
			attrs[prefix+"_story"] = *marker.StoryTime
		}
	case TemporalSourceOrdinal:
		if marker.Ordinal != nil {
			attrs[prefix+"_ordinal"] = strconv.FormatInt(*marker.Ordinal, 10)
		}
	}
}

// deserializeTemporalFromAttrs deserializes a TemporalMarker from edge attributes.
func deserializeTemporalFromAttrs(attrs map[string]string, prefix string) *TemporalMarker {
	sourceStr := attrs[prefix+"_source"]
	if sourceStr == "" {
		return nil
	}

	marker := &TemporalMarker{Source: TemporalSource(sourceStr)}

	switch marker.Source {
	case TemporalSourceChapter:
		if v, ok := attrs[prefix+"_chapter"]; ok {
			if ch, err := strconv.ParseUint(v, 10, 32); err == nil {
				ch32 := uint32(ch)
				marker.Chapter = &ch32
			}
		}
	case TemporalSourceCalendar:
		if v, ok := attrs[prefix+"_calendar"]; ok {
			if cal, err := strconv.ParseInt(v, 10, 64); err == nil {
				marker.Calendar = &cal
			}
		}
	case TemporalSourceStory:
		if v, ok := attrs[prefix+"_story"]; ok {
			marker.StoryTime = &v
		}
	case TemporalSourceOrdinal:
		if v, ok := attrs[prefix+"_ordinal"]; ok {
			if ord, err := strconv.ParseInt(v, 10, 64); err == nil {
				marker.Ordinal = &ord
			}
		}
	}

	if marker.IsZero() {
		return nil
	}
	return marker
}

// deserializeGraphEdge reconstructs a GraphEdge from edge attributes.
func deserializeGraphEdge(targetID string, attrs map[string]string) GraphEdge {
	edge := GraphEdge{
		TargetID: targetID,
		RelType:  attrs["relType"],
		Source:   attrs["source"],
	}

	if v, ok := attrs["confidence"]; ok {
		if conf, err := strconv.ParseFloat(v, 64); err == nil {
			edge.Confidence = conf
		}
	}

	edge.ValidFrom = deserializeTemporalFromAttrs(attrs, "valid_from")
	edge.ValidUntil = deserializeTemporalFromAttrs(attrs, "valid_until")

	return edge
}

// AddGraphEdgeBidirectional adds edges in both directions.
func (idx *GLDRIndex) AddGraphEdgeBidirectional(sourceID, targetID, relType string, confidence float64, source string) {
	srcUUID := idx.ensureVertex(sourceID)
	tgtUUID := idx.ensureVertex(targetID)

	_ = idx.Store.AddEdge(srcUUID, tgtUUID, graph.Edge[uuid.UUID]{
		Source: srcUUID,
		Target: tgtUUID,
		Properties: graph.EdgeProperties{
			Attributes: map[string]string{
				"relType":    relType,
				"confidence": fmt.Sprintf("%f", confidence),
				"source":     source,
			},
		},
	})
	// Note: GraphStore stores bidirectional in warmCache automatically
}

// LoadCooccurrences bulk-loads graph edges from graptor CooccurrenceStats.
func (idx *GLDRIndex) LoadCooccurrences(cooc *graptor.CooccurrenceStats, minCount int) {
	pairs := cooc.GetAllPairs(minCount)
	if len(pairs) == 0 {
		return
	}

	// Find max count for normalization
	maxCount := 0
	for _, pair := range pairs {
		if pair.Count > maxCount {
			maxCount = pair.Count
		}
	}

	idx.mu.Lock()
	idx.MaxEdgeWeight = float64(maxCount)
	idx.mu.Unlock()

	for _, pair := range pairs {
		confidence := float64(pair.Count) / float64(maxCount)
		idx.AddGraphEdgeBidirectional(pair.Entity1ID, pair.Entity2ID, "cooccurs", confidence, "cooccurrence")
	}
}

// LoadGraphEdges bulk-loads semantic graph edges from Graptor ConceptGraphs.
func (idx *GLDRIndex) LoadGraphEdges(docGraph *graptor.DocumentGraph) {
	chapters := docGraph.GetChapters()

	for _, chapter := range chapters {
		if chapter.Graph == nil {
			continue
		}

		// First, ensure all vertices exist
		for _, node := range chapter.Graph.AllNodes() {
			idx.ensureVertex(node.ID)
		}

		// Then, insert explicit edges (Event linkages, Subject/Object bindings)
		for _, edge := range chapter.Graph.AllEdges() {
			// Skip internal edges if they map identically to co-occurrence (e.g., plain cooccurs)
			// But for Causal inference, we WANT these edges: CAUSES, PRECEDES, HAS_SUBJECT, HAS_OBJECT

			// Build temporal marker based on the chapter
			marker := &TemporalMarker{
				Source:  TemporalSourceChapter,
				Chapter: &chapter.ChapterID,
			}

			idx.AddGraphEdgeWithTemporal(edge.Source.ID, GraphEdge{
				TargetID:   edge.Target.ID,
				RelType:    edge.Edge.Relation,
				Confidence: edge.Edge.Weight,
				Source:     "narrative_projection",
			}, marker, nil)
		}
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
	if idx.Semantic != nil {
		idx.Semantic.Delete(chunkID)
	}
}

// resolveProximity computes graph proximity scores using the GraphStore.
func (idx *GLDRIndex) resolveProximity(anchors []EntityAnchor) map[string]float64 {
	if len(anchors) == 0 {
		return nil
	}

	// Build anchor UUID map
	anchorMap := make(map[uuid.UUID]float64, len(anchors))
	for _, a := range anchors {
		uid := EntityUUID(a.EntityID)
		anchorMap[uid] = a.Confidence
	}

	// Use PersonalizedPageRank from GraphStore
	pprScores, err := idx.Store.PersonalizedPageRank(
		anchorMap,
		idx.Config.MaxGraphHops,
		graphstore.PageRankOpts{
			Damping: idx.Config.PPRDamping,
			MaxIter: idx.Config.PPRIterations,
		},
	)
	if err != nil || len(pprScores) == 0 {
		return nil
	}

	// Convert UUID scores back to entity ID scores (single lock acquisition)
	uids := make([]uuid.UUID, 0, len(pprScores))
	for uid := range pprScores {
		uids = append(uids, uid)
	}
	values := idx.Store.BatchVertex(uids)

	result := make(map[string]float64, len(pprScores))
	for uid, score := range pprScores {
		if val, ok := values[uid]; ok && val != "" {
			result[val] = score
		}
	}

	return result
}

// Search executes the full GLDR pipeline.
func (idx *GLDRIndex) Search(query string, config GLDRConfig) []GLDRResult {
	return idx.SearchWithVector(query, nil, config)
}

// SearchWithVector executes GLDR with optional semantic candidate expansion from GDR.
func (idx *GLDRIndex) SearchWithVector(query string, queryVec []float32, config GLDRConfig) []GLDRResult {
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

	// Build candidate set and score maps
	candidates := make([]uint32, 0, len(lexResults)+config.SemanticTopK)
	lexScores := make(map[uint32]float64, len(lexResults))
	semanticScores := make(map[uint32]float64)
	seen := make(map[uint32]bool, len(lexResults)+config.SemanticTopK)

	for _, r := range lexResults {
		uid := idx.QGram.Mapper.Get(r.DocID)
		if uid == 0 {
			continue
		}
		if !seen[uid] {
			candidates = append(candidates, uid)
			seen[uid] = true
		}
		lexScores[uid] = r.Score
	}

	if idx.Semantic != nil && len(queryVec) > 0 {
		semanticConfig := config.SemanticConfig
		semanticConfig.Hard = false
		semanticConfig.LexicalConfig = config.LexicalConfig
		if config.SemanticTopK > 0 {
			semanticConfig.K = config.SemanticTopK
		}
		if config.SemanticAlpha > 0 {
			semanticConfig.ScoreConfig.Alpha = config.SemanticAlpha
		}

		semanticResults := idx.Semantic.Search(gdr.SearchInput{
			TextQuery: query,
			Vector:    queryVec,
		}, semanticConfig)
		for _, result := range semanticResults {
			uid := idx.QGram.Mapper.Get(result.DocID)
			if uid == 0 {
				continue
			}
			if !seen[uid] {
				candidates = append(candidates, uid)
				seen[uid] = true
			}
			if result.Score > semanticScores[uid] {
				semanticScores[uid] = result.Score
			}
			if _, ok := lexScores[uid]; !ok {
				lexScores[uid] = 0
			}
		}
	}

	// 3. Expand candidates with entity chunks (graph-sourced candidates)
	allAnchors := gldrQuery.AllAnchors()
	for _, anchor := range allAnchors {
		if bm, ok := idx.EntityChunks[anchor.EntityID]; ok {
			it := bm.Iterator()
			for it.HasNext() {
				uid := it.Next()
				if !seen[uid] {
					candidates = append(candidates, uid)
					seen[uid] = true
				}
				if _, exists := lexScores[uid]; !exists {
					lexScores[uid] = 0
				}
			}
		}
	}

	if len(candidates) == 0 {
		return nil
	}

	// 4. Compute graph proximity (GraphStore PPR)
	proximity := idx.resolveProximity(allAnchors)

	// 5. Fused scoring
	results := idx.scoreChunks(candidates, proximity, lexScores, semanticScores, config)

	// 6. Limit results
	if config.TopChunks > 0 && len(results) > config.TopChunks {
		results = results[:config.TopChunks]
	}

	return results
}

// SearchNodes executes GLDR and returns entity-level ranked results.
func (idx *GLDRIndex) SearchNodes(query string, config GLDRConfig) []NodeResult {
	return idx.SearchNodesWithVector(query, nil, config)
}

// SearchNodesWithVector executes GLDR node ranking with optional semantic candidate expansion.
func (idx *GLDRIndex) SearchNodesWithVector(query string, queryVec []float32, config GLDRConfig) []NodeResult {
	chunkResults := idx.SearchWithVector(query, queryVec, config)
	if len(chunkResults) == 0 {
		return nil
	}

	idx.mu.RLock()
	defer idx.mu.RUnlock()

	gldrQuery := idx.anchorEntities(query)
	allAnchors := gldrQuery.AllAnchors()
	proximity := idx.resolveProximity(allAnchors)

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
	return idx.scoreChunks(candidates, proximity, lexScores, nil, idx.Config)
}

func (idx *GLDRIndex) scoreChunks(
	candidates []uint32,
	proximity map[string]float64,
	lexScores map[uint32]float64,
	semanticScores map[uint32]float64,
	config GLDRConfig,
) []GLDRResult {
	results := make([]GLDRResult, 0, len(candidates))

	maxLex := 0.0
	for _, s := range lexScores {
		if s > maxLex {
			maxLex = s
		}
	}

	maxSemantic := 0.0
	for _, s := range semanticScores {
		if s > maxSemantic {
			maxSemantic = s
		}
	}

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

	lexWeight, graphWeight := config.Alpha, config.Beta
	if len(proximity) == 0 {
		lexWeight, graphWeight = 1.0, 0.0
	}

	semanticWeight := 0.0
	if maxSemantic > 0 {
		semanticWeight = math.Max(0.0, math.Min(1.0, config.SemanticGamma))
		baseWeight := 1.0 - semanticWeight
		totalBase := lexWeight + graphWeight
		if totalBase > 0 {
			lexWeight = baseWeight * (lexWeight / totalBase)
			graphWeight = baseWeight * (graphWeight / totalBase)
		} else {
			lexWeight = baseWeight
			graphWeight = 0.0
		}
	} else {
		totalBase := lexWeight + graphWeight
		if totalBase > 0 {
			lexWeight /= totalBase
			graphWeight /= totalBase
		}
	}

	for _, uid := range candidates {
		lexNorm := 0.0
		if maxLex > 0 {
			lexNorm = lexScores[uid] / maxLex
		}

		semanticNorm := 0.0
		if maxSemantic > 0 {
			semanticNorm = semanticScores[uid] / maxSemantic
		}

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

		graphNorm := 0.0
		if maxGraph > 0 {
			graphNorm = graphScore / maxGraph
		}

		fusedScore := lexWeight*lexNorm + graphWeight*graphNorm + semanticWeight*semanticNorm

		docID := idx.QGram.Mapper.GetString(uid)
		if docID == "" {
			continue
		}

		results = append(results, GLDRResult{
			ChunkID:         docID,
			ChunkScore:      fusedScore,
			LexScore:        lexScores[uid],
			GraphScore:      graphScore,
			SemanticScore:   semanticScores[uid],
			MatchedEntities: matchedEntities,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		if results[i].ChunkScore == results[j].ChunkScore {
			return results[i].ChunkID < results[j].ChunkID
		}
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

// GetGraphEdges retrieves all outgoing edges for an entity with temporal markers.
func (idx *GLDRIndex) GetGraphEdges(entityID string) []GraphEdge {
	uid := EntityUUID(entityID)
	edges, err := idx.Store.Edges(uid)
	if err != nil {
		return nil
	}

	result := make([]GraphEdge, 0, len(edges))
	for _, edge := range edges {
		targetID, _, err := idx.Store.Vertex(edge.Target)
		if err != nil || targetID == "" {
			continue
		}
		graphEdge := deserializeGraphEdge(targetID, edge.Properties.Attributes)
		result = append(result, graphEdge)
	}

	return result
}

// GetGraphEdgesAt retrieves edges that were valid at a specific temporal marker.
func (idx *GLDRIndex) GetGraphEdgesAt(entityID string, marker *TemporalMarker) []GraphEdge {
	edges := idx.GetGraphEdges(entityID)
	if marker == nil || marker.IsZero() {
		return edges
	}

	result := make([]GraphEdge, 0, len(edges))
	for _, edge := range edges {
		valid, err := edge.IsValidAt(marker)
		if err == nil && valid {
			result = append(result, edge)
		}
	}

	return result
}

// GetAllEdges retrieves all edges in the graph with temporal markers.
func (idx *GLDRIndex) GetAllEdges() []GraphEdge {
	edges, err := idx.Store.ListEdges()
	if err != nil {
		return nil
	}

	result := make([]GraphEdge, 0, len(edges))
	for _, edge := range edges {
		sourceID, _, err1 := idx.Store.Vertex(edge.Source)
		targetID, _, err2 := idx.Store.Vertex(edge.Target)
		if err1 != nil || err2 != nil || sourceID == "" || targetID == "" {
			continue
		}

		graphEdge := deserializeGraphEdge(targetID, edge.Properties.Attributes)
		// Note: sourceID is not stored in GraphEdge, it's implicit from the query
		_ = sourceID // avoid unused variable warning
		result = append(result, graphEdge)
	}

	return result
}

// FilterEdgesByTime filters edges based on temporal query options.
func (idx *GLDRIndex) FilterEdgesByTime(edges []GraphEdge, opts *TemporalQueryOptions) []GraphEdge {
	if opts == nil || opts.TemporalMode == "full" {
		return edges
	}

	result := make([]GraphEdge, 0, len(edges))

	for _, edge := range edges {
		// Handle timeless edges
		if edge.IsTimeless() {
			if opts.IncludeTimeless {
				result = append(result, edge)
			}
			continue
		}

		// Edge has temporal markers - check constraints
		// Check AsOf constraint
		if opts.AsOf != nil && !opts.AsOf.IsZero() {
			valid, err := edge.IsValidAt(opts.AsOf)
			if err != nil || !valid {
				continue
			}
		}

		// Check During range constraint
		if opts.During != nil && !opts.During.IsZero() {
			// Check if edge's valid range overlaps with query range
			inRange, err := idx.edgeInRange(&edge, opts.During)
			if err != nil || !inRange {
				continue
			}
		}

		result = append(result, edge)
	}

	return result
}

// edgeInRange checks if an edge's validity period overlaps with a temporal range.
func (idx *GLDRIndex) edgeInRange(edge *GraphEdge, tr *TemporalRange) (bool, error) {
	// If edge has no start, it's valid from the beginning
	// If edge has no end, it's valid until the end
	// Overlap occurs if: edge.ValidFrom <= tr.End AND edge.ValidUntil >= tr.Start

	// Check if edge starts after range ends
	if edge.ValidFrom != nil && !edge.ValidFrom.IsZero() && tr.End != nil && !tr.End.IsZero() {
		cmp, err := edge.ValidFrom.Compare(tr.End)
		if err != nil {
			return false, err
		}
		if cmp > 0 || (cmp == 0 && !tr.EndInclusive) {
			return false, nil
		}
	}

	// Check if edge ends before range starts
	if edge.ValidUntil != nil && !edge.ValidUntil.IsZero() && tr.Start != nil && !tr.Start.IsZero() {
		cmp, err := edge.ValidUntil.Compare(tr.Start)
		if err != nil {
			return false, err
		}
		if cmp < 0 || (cmp == 0 && !tr.StartInclusive) {
			return false, nil
		}
	}

	return true, nil
}

// TemporalEdgeFilter creates an EdgeFilterFunc from TemporalQueryOptions.
// The filter returns true if an edge should be traversed based on temporal constraints.
func (idx *GLDRIndex) TemporalEdgeFilter(opts *TemporalQueryOptions) graphstore.EdgeFilterFunc {
	if opts == nil {
		return nil // No filtering
	}

	return func(_, _ uint32, edge graph.Edge[uuid.UUID]) bool {
		attrs := edge.Properties.Attributes

		// 1. Relational Filtering
		if len(opts.AllowedRelations) > 0 {
			relType := attrs["relType"]
			allowed := false
			for _, ar := range opts.AllowedRelations {
				if relType == ar {
					allowed = true
					break
				}
			}
			if !allowed {
				return false
			}
		}

		if opts.TemporalMode == "full" {
			return true
		}

		// Check if edge is timeless (no temporal markers)
		hasValidFrom := attrs["valid_from_source"] != ""
		hasValidUntil := attrs["valid_until_source"] != ""

		if !hasValidFrom && !hasValidUntil {
			// Timeless edge
			return opts.IncludeTimeless
		}

		// Edge has temporal markers - check constraints
		// Check AsOf constraint
		if opts.AsOf != nil && !opts.AsOf.IsZero() {
			validFrom := deserializeTemporalFromAttrs(attrs, "valid_from")
			validUntil := deserializeTemporalFromAttrs(attrs, "valid_until")

			// Check if AsOf is within validity period
			if validFrom != nil && !validFrom.IsZero() {
				cmp, err := opts.AsOf.Compare(validFrom)
				if err != nil || cmp < 0 {
					return false
				}
			}
			if validUntil != nil && !validUntil.IsZero() {
				cmp, err := opts.AsOf.Compare(validUntil)
				if err != nil || cmp > 0 {
					return false
				}
			}
		}

		// Check During range constraint
		if opts.During != nil && !opts.During.IsZero() {
			validFrom := deserializeTemporalFromAttrs(attrs, "valid_from")
			validUntil := deserializeTemporalFromAttrs(attrs, "valid_until")

			// Check overlap: edge must not start after range ends, and must not end before range starts
			if validFrom != nil && !validFrom.IsZero() && opts.During.End != nil && !opts.During.End.IsZero() {
				cmp, err := validFrom.Compare(opts.During.End)
				if err != nil {
					return false
				}
				if cmp > 0 || (cmp == 0 && !opts.During.EndInclusive) {
					return false
				}
			}

			if validUntil != nil && !validUntil.IsZero() && opts.During.Start != nil && !opts.During.Start.IsZero() {
				cmp, err := validUntil.Compare(opts.During.Start)
				if err != nil {
					return false
				}
				if cmp < 0 || (cmp == 0 && !opts.During.StartInclusive) {
					return false
				}
			}
		}

		return true
	}
}

// FindPaths finds the shortest path between two entities with optional temporal filtering.
func (idx *GLDRIndex) FindPaths(sourceID, targetID string, opts *TemporalQueryOptions) ([]string, error) {
	srcUUID := EntityUUID(sourceID)
	tgtUUID := EntityUUID(targetID)

	filter := idx.TemporalEdgeFilter(opts)
	path, err := idx.Store.ShortestPathUnweightedFiltered(srcUUID, tgtUUID, filter)
	if err != nil {
		return nil, err
	}

	// Convert UUIDs to entity IDs
	result := make([]string, 0, len(path))
	for _, uid := range path {
		entityID, _, err := idx.Store.Vertex(uid)
		if err != nil {
			continue
		}
		result = append(result, entityID)
	}

	return result, nil
}

// ExtractSubgraph extracts an ego network around an entity with optional temporal filtering.
func (idx *GLDRIndex) ExtractSubgraph(entityID string, depth int, opts *TemporalQueryOptions) (*SubgraphResult, error) {
	rootUUID := EntityUUID(entityID)

	filter := idx.TemporalEdgeFilter(opts)
	sg, err := idx.Store.EgoNetworkFiltered(rootUUID, depth, filter)
	if err != nil {
		return nil, err
	}

	// Convert to result format
	result := &SubgraphResult{
		RootEntity: entityID,
		Nodes:      make([]SubgraphNode, 0, len(sg.Nodes)),
		Edges:      make([]SubgraphEdge, 0, len(sg.Edges)),
	}

	// Convert nodes
	for _, uid := range sg.Nodes {
		nodeID, _, err := idx.Store.Vertex(uid)
		if err != nil {
			continue
		}
		result.Nodes = append(result.Nodes, SubgraphNode{
			EntityID: nodeID,
		})
	}

	// Convert edges
	for _, edge := range sg.Edges {
		srcID, _, err1 := idx.Store.Vertex(edge[0])
		tgtID, _, err2 := idx.Store.Vertex(edge[1])
		if err1 != nil || err2 != nil {
			continue
		}
		result.Edges = append(result.Edges, SubgraphEdge{
			Source: srcID,
			Target: tgtID,
		})
	}

	return result, nil
}

// GetNeighbors returns entities within k hops of an entity with optional temporal filtering.
func (idx *GLDRIndex) GetNeighbors(entityID string, k int, opts *TemporalQueryOptions) ([]string, error) {
	// Use EgoNetworkFiltered which handles the conversion
	sg, err := idx.ExtractSubgraph(entityID, k, opts)
	if err != nil {
		return nil, err
	}

	// Extract unique entity IDs from nodes, excluding the root
	result := make([]string, 0, len(sg.Nodes))
	for _, node := range sg.Nodes {
		if node.EntityID != entityID {
			result = append(result, node.EntityID)
		}
	}

	return result, nil
}

// SubgraphResult represents the result of a subgraph extraction.
type SubgraphResult struct {
	RootEntity string
	Nodes      []SubgraphNode
	Edges      []SubgraphEdge
}

// SubgraphNode represents a node in a subgraph result.
type SubgraphNode struct {
	EntityID string
}

// SubgraphEdge represents an edge in a subgraph result.
type SubgraphEdge struct {
	Source string
	Target string
}
