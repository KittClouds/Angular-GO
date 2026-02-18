package gdr

import (
	"fmt"
	"math/rand"
	"testing"

	"github.com/kittclouds/gokitt/pkg/hnsw/distance"
)

// BenchmarkCollapsedTree simulates the "collapsed-tree" search scenario
// where we filter a large HNSW index by a set of allowed leaf IDs.
//
// Scenarios:
// - Light: Few allowed leaves (e.g., 50) - simulates narrow context
// - Heavy: Many allowed leaves (e.g., 500) - simulates broad context (P99 culprit?)
// - Full: No filter (baseline HNSW)
func BenchmarkCollapsedTree(b *testing.B) {
	// 1. Setup Index with realistic scale
	// 10,000 documents, 384 dimensions
	numDocs := 10000
	dim := 384
	config := DefaultGDRConfig()
	config.K = 10
	config.EfSearch = 50 // Default
	config.MaxExpansions = 3

	gdr := NewGDR(config)
	rng := rand.New(rand.NewSource(42))

	// Pre-generate vectors to avoid benchmark setup noise
	vectors := make([][]float32, numDocs)
	for i := 0; i < numDocs; i++ {
		vectors[i] = make([]float32, dim)
		for j := 0; j < dim; j++ {
			vectors[i][j] = rng.Float32()
		}
	}

	// Insert docs
	for i := 0; i < numDocs; i++ {
		id := fmt.Sprintf("doc-%d", i)
		// We don't care about lexical content for this vector-heavy benchmark
		gdr.Upsert(id, nil, vectors[i])
	}

	// Query Vector
	queryVec := make([]float32, dim)
	for j := 0; j < dim; j++ {
		queryVec[j] = rng.Float32()
	}

	scenarios := []struct {
		name       string
		numAllowed int
	}{
		{"Light_50", 50},
		{"Medium_200", 200},
		{"Heavy_1000", 1000},   // P99 Suspect
		{"All_10000", numDocs}, // Worst case filter
	}

	for _, sc := range scenarios {
		// Generate allowed IDs map
		allowedIDs := make(map[string]bool)
		allowedUIDs := make(map[uint32]bool)

		// Randomly select ID strings
		perm := rng.Perm(numDocs)
		for i := 0; i < sc.numAllowed; i++ {
			id := fmt.Sprintf("doc-%d", perm[i])
			allowedIDs[id] = true
			allowedUIDs[gdr.Lex.Mapper.Get(id)] = true
		}

		b.Run(sc.name+"_HNSW", func(b *testing.B) {
			filter := func(id uint32) bool {
				return allowedUIDs[id]
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Call HNSW directly to bypass GDR search's text requirement
				results := gdr.Vec.SearchKNNFiltered(queryVec, config.K, config.EfSearch, filter)
				if len(results) == 0 && sc.numAllowed > 0 {
					// ignore
				}
			}
		})

		if sc.numAllowed < 2000 { // Brute Force only viable for small subsets
			b.Run(sc.name+"_BruteForce", func(b *testing.B) {
				// Pre-compute query magnitude
				qMag := distance.Magnitude(queryVec)
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					// Simulate Brute Force Search
					count := 0
					for uid := range allowedUIDs {
						v, ok := gdr.Vec.GetVector(dim, uid)
						if ok {
							// Use exact same metric as HNSW
							_ = distance.CosineSimilarity(queryVec, v, qMag, 0)
							count++
						}
					}
				}
			})
		}
	}
}
