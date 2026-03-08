package gdr

import (
	"sort"
	"strings"

	"github.com/kittclouds/gokitt/pkg/hnsw"
	"github.com/kittclouds/gokitt/pkg/qgram"
)

// SearchInput represents a GDR search query with both text and vector.
type SearchInput struct {
	TextQuery  string          // Lexical query string
	Vector     []float32       // Query vector (can be nil for lexical-only)
	AllowedIDs map[string]bool // Optional: restrict search to these DocIDs
}

// Search executes a GDR search query.
// This implements the "Gate-Driven" approach:
// 1. Parse lexical query into clauses
// 2. Build lexical gate bitmap (candidate generation)
// 3. Filtered HNSW search (if vector provided)
// 4. Verify and score candidates
// 5. Expansion loop if needed
func (gdr *GateDrivenRetriever) Search(input SearchInput, config GDRConfig) []GDRResult {
	// Pre-compute allowed UIDs if provided
	var allowedUIDs map[uint32]bool
	if len(input.AllowedIDs) > 0 {
		allowedUIDs = make(map[uint32]bool, len(input.AllowedIDs))
		for id := range input.AllowedIDs {
			uid := gdr.Lex.Mapper.Get(id)
			if uid > 0 {
				allowedUIDs[uid] = true
			}
		}
		if len(allowedUIDs) == 0 {
			return []GDRResult{}
		}
	}

	clauses := qgram.ParseQuery(input.TextQuery)
	if len(clauses) == 0 {
		if len(input.Vector) > 0 && !config.Hard {
			return gdr.searchVectorOnlyNoGate(input.Vector, clauses, allowedUIDs, config)
		}
		return []GDRResult{}
	}

	gate := gdr.BuildGateBitmap(clauses, config.GateMaxCandidates)
	if gate.IsEmpty() {
		if len(input.Vector) > 0 && !config.Hard {
			return gdr.searchVectorOnlyNoGate(input.Vector, clauses, allowedUIDs, config)
		}
		return []GDRResult{}
	}

	if len(input.Vector) == 0 {
		return gdr.searchLexicalOnly(clauses, gate, allowedUIDs, config)
	}

	if config.Hard {
		if len(allowedUIDs) > 0 && len(allowedUIDs) <= 2000 {
			return gdr.searchBruteForce(input.Vector, clauses, gate, allowedUIDs, config)
		}
		return gdr.searchWithExpansion(input.Vector, clauses, gate, allowedUIDs, config)
	}

	gatedResults := func() []GDRResult {
		if len(allowedUIDs) > 0 && len(allowedUIDs) <= 2000 {
			return gdr.searchBruteForce(input.Vector, clauses, gate, allowedUIDs, config)
		}
		return gdr.searchWithExpansion(input.Vector, clauses, gate, allowedUIDs, config)
	}()

	semanticResults := gdr.searchVectorOnlyNoGate(input.Vector, clauses, allowedUIDs, config)
	return mergeResults(gatedResults, semanticResults, config.K)
}

// searchLexicalOnly performs lexical-only search (no vector component).
func (gdr *GateDrivenRetriever) searchLexicalOnly(clauses []qgram.Clause, gate *GateResult, allowedUIDs map[uint32]bool, config GDRConfig) []GDRResult {
	candidates := make([]hnsw.Result, 0)
	it := gate.Iterator()
	for it.HasNext() {
		uid := it.Next()
		if allowedUIDs != nil && !allowedUIDs[uid] {
			continue
		}
		candidates = append(candidates, hnsw.Result{ID: uid, Score: 1.0})
	}

	results := gdr.verifyAndScore(candidates, clauses, config)
	if config.K > 0 && len(results) > config.K {
		results = results[:config.K]
	}
	return results
}

// searchWithExpansion performs filtered HNSW search with expansion loop.
func (gdr *GateDrivenRetriever) searchWithExpansion(
	queryVec []float32,
	clauses []qgram.Clause,
	gate *GateResult,
	allowedUIDs map[uint32]bool,
	config GDRConfig,
) []GDRResult {
	k := config.K
	if k == 0 {
		k = 10
	}

	ef := config.EfSearch
	if ef == 0 {
		ef = 50
	}

	fetchCap := config.FetchCap
	if fetchCap == 0 {
		fetchCap = 1000
	}

	expansionFactor := config.ExpansionFactor
	if expansionFactor == 0 {
		expansionFactor = 4
	}

	maxExpansions := config.MaxExpansions
	if maxExpansions == 0 {
		maxExpansions = 3
	}

	var results []GDRResult
	expansions := 0
	fetchK := k * expansionFactor

	for expansions < maxExpansions {
		if fetchK > fetchCap {
			fetchK = fetchCap
		}

		filter := func(id uint32) bool {
			if allowedUIDs != nil && !allowedUIDs[id] {
				return false
			}
			return gate.Contains(id)
		}

		candidates := gdr.Vec.SearchKNNFiltered(queryVec, fetchK, ef, filter)
		if len(candidates) == 0 {
			break
		}

		results = gdr.verifyAndScore(candidates, clauses, config)
		if len(results) >= k {
			break
		}

		fetchK *= expansionFactor
		ef *= 2
		expansions++
	}

	if k > 0 && len(results) > k {
		results = results[:k]
	}
	return results
}

func (gdr *GateDrivenRetriever) searchVectorOnlyNoGate(
	queryVec []float32,
	clauses []qgram.Clause,
	allowedUIDs map[uint32]bool,
	config GDRConfig,
) []GDRResult {
	if len(queryVec) == 0 {
		return []GDRResult{}
	}

	k := config.K
	if k == 0 {
		k = 10
	}

	fetchK := config.FetchCap
	if fetchK == 0 {
		fetchK = 1000
	}
	if fetchK < k {
		fetchK = k
	}

	if len(allowedUIDs) > 0 && len(allowedUIDs) <= 2000 {
		return gdr.searchBruteForceNoGate(queryVec, clauses, allowedUIDs, config)
	}

	var candidates []hnsw.Result
	if allowedUIDs != nil {
		filter := func(id uint32) bool {
			return allowedUIDs[id]
		}
		candidates = gdr.Vec.SearchKNNFiltered(queryVec, fetchK, config.EfSearch, filter)
	} else {
		candidates = gdr.Vec.SearchKNN(queryVec, fetchK, config.EfSearch)
	}

	results := gdr.verifyAndScore(candidates, clauses, config)
	if k > 0 && len(results) > k {
		results = results[:k]
	}
	return results
}

func mergeResults(primary, extra []GDRResult, k int) []GDRResult {
	merged := make(map[string]GDRResult, len(primary)+len(extra))
	for _, result := range primary {
		merged[result.DocID] = result
	}
	for _, result := range extra {
		if existing, ok := merged[result.DocID]; ok {
			if result.Score > existing.Score {
				merged[result.DocID] = result
			}
			continue
		}
		merged[result.DocID] = result
	}

	out := make([]GDRResult, 0, len(merged))
	for _, result := range merged {
		out = append(out, result)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].DocID < out[j].DocID
		}
		return out[i].Score > out[j].Score
	})

	if k > 0 && len(out) > k {
		out = out[:k]
	}
	return out
}

// SearchWithScope performs a GDR search with scope constraints.
func (gdr *GateDrivenRetriever) SearchWithScope(input SearchInput, config GDRConfig, narrativeID, folderPath string) []GDRResult {
	config.LexicalConfig.Scope = &qgram.SearchScope{
		NarrativeID: narrativeID,
		FolderPath:  folderPath,
	}
	return gdr.Search(input, config)
}

// SearchLexical performs lexical-only search (no vector component).
func (gdr *GateDrivenRetriever) SearchLexical(textQuery string, config GDRConfig) []GDRResult {
	return gdr.Search(SearchInput{TextQuery: textQuery}, config)
}

// SearchVector performs vector-only search with lexical gate.
func (gdr *GateDrivenRetriever) SearchVector(textQuery string, queryVec []float32, config GDRConfig) []GDRResult {
	return gdr.Search(SearchInput{TextQuery: textQuery, Vector: queryVec}, config)
}

// Count returns the number of documents matching the lexical query.
func (gdr *GateDrivenRetriever) Count(textQuery string) int {
	clauses := qgram.ParseQuery(textQuery)
	if len(clauses) == 0 {
		return 0
	}

	gate := gdr.BuildGateBitmap(clauses, 0)
	return int(gate.GateSize())
}

// CountWithScope returns the number of documents matching the query within scope.
func (gdr *GateDrivenRetriever) CountWithScope(textQuery, narrativeID, folderPath string) int {
	clauses := qgram.ParseQuery(textQuery)
	if len(clauses) == 0 {
		return 0
	}

	gate := gdr.BuildGateBitmap(clauses, 0)
	count := 0
	it := gate.Iterator()
	for it.HasNext() {
		uid := it.Next()
		docID := gdr.Lex.Mapper.GetString(uid)
		if docID == "" {
			continue
		}
		doc, ok := gdr.Lex.Documents[docID]
		if !ok {
			continue
		}
		if narrativeID != "" && doc.NarrativeID != narrativeID {
			continue
		}
		if folderPath != "" && !strings.HasPrefix(doc.FolderPath, folderPath) {
			continue
		}
		count++
	}

	return count
}
