package gdr

import (
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
		// If map provided but no valid UIDs found, return empty
		if len(allowedUIDs) == 0 {
			return []GDRResult{}
		}
	}

	// 1. Parse lexical query
	clauses := qgram.ParseQuery(input.TextQuery)
	if len(clauses) == 0 {
		return []GDRResult{}
	}

	// Apply scope from config
	if config.LexicalConfig.Scope != nil {
		// Scope is applied during verification
	}

	// 2. Build lexical gate bitmap
	gate := gdr.BuildGateBitmap(clauses, config.GateMaxCandidates)
	if gate.IsEmpty() {
		return []GDRResult{}
	}

	// 3. If no vector, fall back to lexical-only search
	if len(input.Vector) == 0 {
		return gdr.searchLexicalOnly(clauses, gate, allowedUIDs, config)
	}

	// 4. GDR Search (Brute Force fallback for small scopes)
	// Benchmark shows HNSW is often faster (avg 63µs vs 242µs for N=1000),
	// but Brute Force guarantees <1ms latency and eliminates P99 spikes (100ms+)
	// caused by pathological graph traversal or GC.
	if len(allowedUIDs) > 0 && len(allowedUIDs) <= 2000 {
		return gdr.searchBruteForce(input.Vector, clauses, gate, allowedUIDs, config)
	}

	// 5. Filtered HNSW search with expansion loop
	return gdr.searchWithExpansion(input.Vector, clauses, gate, allowedUIDs, config)
}

// searchLexicalOnly performs lexical-only search (no vector component).
func (gdr *GateDrivenRetriever) searchLexicalOnly(clauses []qgram.Clause, gate *GateResult, allowedUIDs map[uint32]bool, config GDRConfig) []GDRResult {
	// Convert gate bitmap to candidates
	candidates := make([]hnsw.Result, 0)
	it := gate.Iterator()
	for it.HasNext() {
		uid := it.Next()
		if allowedUIDs != nil && !allowedUIDs[uid] {
			continue
		}
		candidates = append(candidates, hnsw.Result{
			ID:    uid,
			Score: 1.0, // Neutral score for lexical-only
		})
	}

	// Verify and score
	results := gdr.verifyAndScore(candidates, clauses, config)

	// Limit results
	if config.K > 0 && len(results) > config.K {
		results = results[:config.K]
	}

	return results
}

// searchWithExpansion performs filtered HNSW search with expansion loop.
// Because PhraseHard can reject neighbors, we may need to fetch more candidates
// and expand the search if we don't get enough verified results.
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
		// Cap fetch at FetchCap
		if fetchK > fetchCap {
			fetchK = fetchCap
		}

		// Filter predicate: check if ID is in gate bitmap AND allowed set
		filter := func(id uint32) bool {
			if allowedUIDs != nil && !allowedUIDs[id] {
				return false
			}
			return gate.Contains(id)
		}

		// Search HNSW with filter
		candidates := gdr.Vec.SearchKNNFiltered(queryVec, fetchK, ef, filter)

		if len(candidates) == 0 {
			break // No more candidates
		}

		// Verify and score
		results = gdr.verifyAndScore(candidates, clauses, config)

		// Check if we have enough results
		if len(results) >= k {
			break
		}

		// Expand search parameters
		fetchK *= expansionFactor
		ef *= 2
		expansions++
	}

	// Limit results
	if k > 0 && len(results) > k {
		results = results[:k]
	}

	return results
}

// SearchWithScope performs a GDR search with scope constraints.
func (gdr *GateDrivenRetriever) SearchWithScope(input SearchInput, config GDRConfig, narrativeID, folderPath string) []GDRResult {
	// Set scope in config
	config.LexicalConfig.Scope = &qgram.SearchScope{
		NarrativeID: narrativeID,
		FolderPath:  folderPath,
	}
	return gdr.Search(input, config)
}

// SearchLexical performs lexical-only search (no vector component).
// This is a convenience method for text-only queries.
func (gdr *GateDrivenRetriever) SearchLexical(textQuery string, config GDRConfig) []GDRResult {
	return gdr.Search(SearchInput{TextQuery: textQuery}, config)
}

// SearchVector performs vector-only search with lexical gate.
// The textQuery is used only for the lexical gate, not for scoring.
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

	// Apply scope filter
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
