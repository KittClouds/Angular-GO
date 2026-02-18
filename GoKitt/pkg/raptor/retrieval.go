package raptor

import (
	"sort"

	"github.com/kittclouds/gokitt/pkg/gdr"
	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
)

// CollapsedRetriever implements R3: collapsed-tree retrieval.
// Router pass (internal nodes) → Hard leaf pass (filtered HNSW) → Context expansion.
type CollapsedRetriever struct {
	index *RaptorIndex
}

// NewCollapsedRetriever creates a new collapsed-tree retriever.
func NewCollapsedRetriever(index *RaptorIndex) *CollapsedRetriever {
	return &CollapsedRetriever{index: index}
}

// Search performs collapsed-tree retrieval.
// 1. Router pass: search internal nodes to identify candidate subtrees
// 2. Hard leaf pass: search leaves within those subtrees with lexical gate
// 3. Context expansion: return chunks with parent context
func (cr *CollapsedRetriever) Search(query string, queryVec []float32, k int) []CollapsedResult {
	if cr.index == nil || cr.index.gdr == nil {
		return nil
	}

	// 1. Router pass: find candidate documents via internal nodes
	routerK := k * 4
	if routerK < cr.index.config.MinRouterK {
		routerK = cr.index.config.MinRouterK
	}
	candidateDocs := cr.routerPass(queryVec, routerK)
	if len(candidateDocs) == 0 {
		// Fallback: search all leaves
		return cr.searchAllLeaves(query, queryVec, k)
	}

	// 2. Hard leaf pass: search leaves within candidate docs
	results := cr.hardLeafPass(query, queryVec, candidateDocs, k)

	// 3. Context expansion: add parent context
	return cr.expandContext(results)
}

// routerPass searches internal nodes to identify candidate documents.
// Returns a set of docIDs that are semantically relevant.
func (cr *CollapsedRetriever) routerPass(queryVec []float32, topK int) map[string]float64 {
	candidateDocs := make(map[string]float64)

	// Search internal nodes across all trees
	for docID, tree := range cr.index.trees {
		if tree == nil || len(tree.Internal) == 0 {
			continue
		}

		// Find best matching internal node for this doc
		bestScore := float32(-1)
		for _, nodeID := range tree.Internal {
			node := tree.Nodes[nodeID]
			if node == nil || len(node.Vector) == 0 {
				continue
			}

			score := distance.CosineSimilarity(queryVec, node.Vector, 0, 0)
			if score > bestScore {
				bestScore = score
			}
		}

		if bestScore > 0 {
			candidateDocs[docID] = float64(bestScore)
		}
	}

	// Limit to topK docs
	if len(candidateDocs) > topK {
		type docScore struct {
			docID string
			score float64
		}
		scores := make([]docScore, 0, len(candidateDocs))
		for docID, score := range candidateDocs {
			scores = append(scores, docScore{docID: docID, score: score})
		}
		sort.Slice(scores, func(i, j int) bool {
			return scores[i].score > scores[j].score
		})

		candidateDocs = make(map[string]float64)
		for i := 0; i < topK && i < len(scores); i++ {
			candidateDocs[scores[i].docID] = scores[i].score
		}
	}

	return candidateDocs
}

// hardLeafPass searches leaves within candidate documents using hard hybrid.
func (cr *CollapsedRetriever) hardLeafPass(query string, queryVec []float32, candidateDocs map[string]float64, k int) []CollapsedResult {
	// Build allowed leaf set (bitmap of leaf chunk keys)
	allowedLeaves := make(map[string]bool)
	for docID := range candidateDocs {
		tree := cr.index.trees[docID]
		if tree == nil {
			continue
		}
		for _, leafID := range tree.Leaves {
			node := tree.Nodes[leafID]
			if node != nil {
				chunkKey := cr.index.chunkKey(docID, node.Start, node.End)
				allowedLeaves[chunkKey] = true
			}
		}
	}

	if len(allowedLeaves) == 0 {
		return nil
	}

	// Search hybrid index with allowed IDs filter
	results := cr.index.gdr.Search(gdr.SearchInput{
		TextQuery:  query,
		Vector:     queryVec,
		AllowedIDs: allowedLeaves,
	}, cr.index.config.GDRConfig)

	// Convert results
	out := make([]CollapsedResult, 0, len(results))
	for _, hr := range results {
		docID, start, end := parseChunkKey(hr.DocID)
		out = append(out, CollapsedResult{
			DocID:       docID,
			ChunkKey:    hr.DocID,
			Start:       start,
			End:         end,
			Score:       hr.Score,
			LexScore:    hr.LexScore,
			VecScore:    hr.VecScore,
			RouterScore: candidateDocs[docID],
		})

		if len(out) >= k {
			break
		}
	}

	return out
}

// searchAllLeaves is a fallback when router finds no candidates.
func (cr *CollapsedRetriever) searchAllLeaves(query string, queryVec []float32, k int) []CollapsedResult {
	results := cr.index.gdr.Search(gdr.SearchInput{
		TextQuery: query,
		Vector:    queryVec,
	}, cr.index.config.GDRConfig)

	out := make([]CollapsedResult, 0, k)
	for _, hr := range results {
		docID, start, end := parseChunkKey(hr.DocID)
		out = append(out, CollapsedResult{
			DocID:    docID,
			ChunkKey: hr.DocID,
			Start:    start,
			End:      end,
			Score:    hr.Score,
			LexScore: hr.LexScore,
			VecScore: hr.VecScore,
		})

		if len(out) >= k {
			break
		}
	}

	return out
}

// expandContext adds parent context to results.
func (cr *CollapsedRetriever) expandContext(results []CollapsedResult) []CollapsedResult {
	for i := range results {
		cr.addParentContext(&results[i])
	}
	return results
}

// addParentContext adds parent node text to a result.
func (cr *CollapsedRetriever) addParentContext(result *CollapsedResult) {
	tree := cr.index.trees[result.DocID]
	if tree == nil {
		return
	}

	// Find the leaf node
	for _, leafID := range tree.Leaves {
		node := tree.Nodes[leafID]
		if node == nil {
			continue
		}
		if node.Start == result.Start && node.End == result.End {
			// Found the leaf, get parent context
			if node.ParentID != 0 {
				parent := tree.Nodes[node.ParentID]
				if parent != nil {
					result.ParentText = parent.Text
					result.ParentID = parent.ID
				}
			}
			break
		}
	}
}

// CollapsedResult represents a result from collapsed-tree retrieval.
type CollapsedResult struct {
	DocID       string  // Source document ID
	ChunkKey    string  // Chunk key in hybrid index
	Start       int     // Byte offset in original doc
	End         int     // End offset
	Score       float64 // Combined score
	LexScore    float64 // Lexical score
	VecScore    float32 // Vector similarity
	RouterScore float64 // Score from router pass (internal node)
	ParentID    uint32  // Parent node ID (if any)
	ParentText  string  // Parent node text (context)
}

// SearchWithAggregation performs R4: search with chunk → doc aggregation.
func (cr *CollapsedRetriever) SearchWithAggregation(query string, queryVec []float32, k int) []DocResult {
	chunkResults := cr.Search(query, queryVec, k*2)

	// Aggregate by doc
	docMap := make(map[string]*DocResult)
	for _, cr := range chunkResults {
		if docMap[cr.DocID] == nil {
			docMap[cr.DocID] = &DocResult{
				DocID:    cr.DocID,
				Chunks:   []CollapsedResult{},
				MaxScore: cr.Score,
			}
		}
		dr := docMap[cr.DocID]
		dr.Chunks = append(dr.Chunks, cr)
		if cr.Score > dr.MaxScore {
			dr.MaxScore = cr.Score
		}
	}

	// Sort docs by max score
	docs := make([]DocResult, 0, len(docMap))
	for _, dr := range docMap {
		docs = append(docs, *dr)
	}
	sort.Slice(docs, func(i, j int) bool {
		return docs[i].MaxScore > docs[j].MaxScore
	})

	// Limit to k docs
	if len(docs) > k {
		docs = docs[:k]
	}

	return docs
}

// DocResult represents an aggregated document result.
type DocResult struct {
	DocID    string            // Document ID
	MaxScore float64           // Best chunk score
	Chunks   []CollapsedResult // Matching chunks
}
