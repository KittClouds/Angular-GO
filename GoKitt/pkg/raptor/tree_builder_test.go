package raptor

import (
	"testing"
)

func TestTreeBuilder_Build(t *testing.T) {
	// Create a tree with leaf nodes
	tree := &RaptorTree{
		DocID:  "testdoc",
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: []uint32{},
	}

	// Add leaf nodes with vectors
	for i := 0; i < 12; i++ {
		id := uint32(i + 1)
		node := &RaptorNode{
			ID:     id,
			DocID:  "testdoc",
			Type:   NodeTypeLeaf,
			Level:  0,
			Text:   "This is test sentence number " + intToStr(i) + " for clustering.",
			Vector: make([]float32, 64),
		}
		// Create distinct vectors for clustering
		for j := range node.Vector {
			node.Vector[j] = float32(i*10+j) / 100.0
		}
		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
	}

	// Build tree
	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, nil) // nil embedFn = use mean vectors

	// Verify tree structure
	if len(tree.Internal) == 0 {
		t.Error("Expected internal nodes to be created")
	}

	// Verify all internal nodes have children
	for _, nodeID := range tree.Internal {
		node := tree.Nodes[nodeID]
		if node == nil {
			t.Errorf("Internal node %d not found", nodeID)
			continue
		}
		if node.Type != NodeTypeInternal && node.Type != NodeTypeRoot {
			t.Errorf("Expected internal/root type, got %d", node.Type)
		}
		if len(node.ChildIDs) == 0 {
			t.Errorf("Internal node %d has no children", nodeID)
		}
		if len(node.Vector) == 0 {
			t.Errorf("Internal node %d has no vector", nodeID)
		}
	}

	// Verify parent-child relationships
	for _, nodeID := range tree.Internal {
		node := tree.Nodes[nodeID]
		for _, childID := range node.ChildIDs {
			child := tree.Nodes[childID]
			if child == nil {
				t.Errorf("Child %d not found", childID)
				continue
			}
			if child.ParentID != nodeID {
				t.Errorf("Child %d has wrong parent %d, expected %d", childID, child.ParentID, nodeID)
			}
		}
	}
}

func TestTreeBuilder_SmallTree(t *testing.T) {
	// Tree with few nodes (should not create multiple levels)
	tree := &RaptorTree{
		DocID:  "smalldoc",
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: []uint32{},
	}

	// Only 3 leaves
	for i := 0; i < 3; i++ {
		id := uint32(i + 1)
		node := &RaptorNode{
			ID:     id,
			DocID:  "smalldoc",
			Type:   NodeTypeLeaf,
			Level:  0,
			Text:   "Short text " + intToStr(i),
			Vector: make([]float32, 32),
		}
		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
	}

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, nil)

	// Should have a root but not much else
	if tree.RootID == 0 {
		t.Error("Expected root node to be created")
	}
}

func TestTreeBuilder_WithEmbedFn(t *testing.T) {
	tree := &RaptorTree{
		DocID:  "testdoc",
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: []uint32{},
	}

	for i := 0; i < 6; i++ {
		id := uint32(i + 1)
		node := &RaptorNode{
			ID:     id,
			DocID:  "testdoc",
			Type:   NodeTypeLeaf,
			Level:  0,
			Text:   "Text " + intToStr(i),
			Vector: make([]float32, 16),
		}
		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
	}

	// Custom embed function
	embedCalls := 0
	embedFn := func(text string) []float32 {
		embedCalls++
		vec := make([]float32, 16)
		for i, c := range text {
			if i < 16 {
				vec[i] = float32(c) / 255.0
			}
		}
		return vec
	}

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, embedFn)

	if embedCalls == 0 {
		t.Error("Expected embedFn to be called for internal nodes")
	}
}

func TestTreeBuilder_EmptyTree(t *testing.T) {
	tree := &RaptorTree{
		DocID:  "empty",
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: []uint32{},
	}

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, nil)

	if len(tree.Internal) != 0 {
		t.Error("Expected no internal nodes for empty tree")
	}
}

func TestTreeBuilder_NoVectors(t *testing.T) {
	tree := &RaptorTree{
		DocID:  "novectors",
		Nodes:  make(map[uint32]*RaptorNode),
		Leaves: []uint32{},
	}

	// Leaves without vectors
	for i := 0; i < 5; i++ {
		id := uint32(i + 1)
		node := &RaptorNode{
			ID:     id,
			DocID:  "novectors",
			Type:   NodeTypeLeaf,
			Level:  0,
			Text:   "Text " + intToStr(i),
			Vector: nil, // No vector
		}
		tree.Nodes[id] = node
		tree.Leaves = append(tree.Leaves, id)
	}

	tb := NewTreeBuilder(DefaultTreeBuilderConfig())
	tb.Build(tree, nil)

	// Should not create internal nodes without vectors
	if len(tree.Internal) != 0 {
		t.Error("Expected no internal nodes when leaves have no vectors")
	}
}

func TestKMeans_Clustering(t *testing.T) {
	tb := NewTreeBuilder(TreeBuilderConfig{ClusterMin: 2, ClusterK: 3})

	// Create nodes with distinct clusters
	nodes := make([]*RaptorNode, 9)

	// Cluster 1: low values
	for i := 0; i < 3; i++ {
		nodes[i] = &RaptorNode{
			ID:     uint32(i + 1),
			Vector: []float32{0.1, 0.1, 0.1},
		}
	}

	// Cluster 2: medium values
	for i := 3; i < 6; i++ {
		nodes[i] = &RaptorNode{
			ID:     uint32(i + 1),
			Vector: []float32{0.5, 0.5, 0.5},
		}
	}

	// Cluster 3: high values
	for i := 6; i < 9; i++ {
		nodes[i] = &RaptorNode{
			ID:     uint32(i + 1),
			Vector: []float32{0.9, 0.9, 0.9},
		}
	}

	clusters := tb.kMeans(nodes, 3)

	if len(clusters) == 0 {
		t.Fatal("Expected clusters to be created")
	}

	// Each cluster should have nodes
	totalNodes := 0
	for i, cluster := range clusters {
		if len(cluster) == 0 {
			t.Errorf("Cluster %d is empty", i)
		}
		totalNodes += len(cluster)
	}

	if totalNodes != 9 {
		t.Errorf("Expected 9 total nodes, got %d", totalNodes)
	}
}

func TestExtractiveSummary(t *testing.T) {
	tb := NewTreeBuilder(DefaultTreeBuilderConfig())

	nodes := []*RaptorNode{
		{Text: "Short text."},
		{Text: "This is a longer piece of text that should be included."},
		{Text: "Medium length text here."},
	}

	summary := tb.extractiveSummary(nodes)

	if summary == "" {
		t.Error("Expected non-empty summary")
	}

	// Summary should be limited to maxLen
	if len(summary) > 600 { // maxLen + some buffer for spaces
		t.Errorf("Summary too long: %d chars", len(summary))
	}
}

func TestCosineDistance(t *testing.T) {
	tests := []struct {
		a, b   []float32
		expect float32
	}{
		{
			a:      []float32{1.0, 0.0, 0.0},
			b:      []float32{1.0, 0.0, 0.0},
			expect: 0.0, // Same vector = distance 0
		},
		{
			a:      []float32{1.0, 0.0, 0.0},
			b:      []float32{0.0, 1.0, 0.0},
			expect: 1.0, // Orthogonal = distance 1
		},
		{
			a:      []float32{1.0, 0.0, 0.0},
			b:      []float32{-1.0, 0.0, 0.0},
			expect: 2.0, // Opposite = distance 2
		},
	}

	for _, tt := range tests {
		d := cosineDistance(tt.a, tt.b)
		if abs(d-tt.expect) > 0.001 {
			t.Errorf("cosineDistance(%v, %v) = %f, want %f", tt.a, tt.b, d, tt.expect)
		}
	}
}

func abs(x float32) float32 {
	if x < 0 {
		return -x
	}
	return x
}
