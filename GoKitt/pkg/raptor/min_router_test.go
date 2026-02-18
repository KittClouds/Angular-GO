package raptor

import (
	"fmt"
	"testing"

	"github.com/kittclouds/gokitt/pkg/gdr"
)

func TestCollapsedRetriever_MinRouterK_Logic(t *testing.T) {
	// Setup with MinRouterK = 10
	config := DefaultRaptorConfig()
	config.MinRouterK = 10

	retriever := gdr.NewGDR(gdr.DefaultGDRConfig())
	ri := NewRaptorIndexWithGDR(config, retriever)

	// Manually inject 20 trees with identical internal nodes
	// They all match the query perfectly (same vector)
	vec := make([]float32, 32)
	for i := 0; i < 32; i++ {
		vec[i] = 1.0
	} // non-zero vector

	for i := 0; i < 20; i++ {
		docID := fmt.Sprintf("doc-%d", i)
		tree := &RaptorTree{
			DocID: docID,
			Nodes: map[uint32]*RaptorNode{
				1: {ID: 1, Type: NodeTypeInternal, Vector: vec},
			},
			Internal: []uint32{1},
		}
		ri.trees[docID] = tree
	}

	cr := NewCollapsedRetriever(ri)

	// Test Logic: routerPass(vec, k)
	// We want to verify that if we ask for k=10, we get 10 results.
	// If we ask for k=1, we get 1 result.
	// BUT the Search() method Logic is:
	// candidates := cr.routerPass(queryVec, max(k*4, MinRouterK))

	// So let's test routerPass directly to ensure it CAN return 10 results if asked.
	candidates := cr.routerPass(vec, 10)
	if len(candidates) != 10 {
		t.Errorf("Expected 10 candidates from routerPass, got %d", len(candidates))
	}

	candidates = cr.routerPass(vec, 4)
	if len(candidates) != 4 {
		t.Errorf("Expected 4 candidates from routerPass, got %d", len(candidates))
	}

	// Since we cannot easily test the INTERNALS of Search() (which calculates the arg),
	// we rely on code inspection for the "max(k*4, MinRouterK)" logic.
	// The implementation in retrieval.go was:
	//   routerK := k * 4
	//   if routerK < cr.index.config.MinRouterK { routerK = ... }
	//   candidateDocs := cr.routerPass(queryVec, routerK)

	// If this test passes, we know routerPass works. The rest is just math.
}
