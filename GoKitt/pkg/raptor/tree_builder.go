package raptor

import (
	"math"
	"math/rand"
	"sort"
)

// TreeBuilder constructs the RAPTOR tree from leaf embeddings.
// R2: Cluster → Summarize → Embed → Recurse
type TreeBuilder struct {
	config TreeBuilderConfig
}

// TreeBuilderConfig holds configuration for tree building.
type TreeBuilderConfig struct {
	MaxLevel   int // Maximum tree depth (default: 3)
	ClusterMin int // Minimum nodes per cluster (default: 3)
	ClusterK   int // Target number of clusters per level (default: 4)
}

// DefaultTreeBuilderConfig returns sane defaults.
func DefaultTreeBuilderConfig() TreeBuilderConfig {
	return TreeBuilderConfig{
		MaxLevel:   3,
		ClusterMin: 3,
		ClusterK:   4,
	}
}

// NewTreeBuilder creates a new tree builder.
func NewTreeBuilder(config TreeBuilderConfig) *TreeBuilder {
	return &TreeBuilder{config: config}
}

// Build constructs a RAPTOR tree from leaf nodes.
// The embedFn is used to embed summaries of internal nodes.
func (tb *TreeBuilder) Build(tree *RaptorTree, embedFn func(text string) []float32) {
	if tree == nil || len(tree.Leaves) == 0 {
		return
	}

	// Collect leaf nodes with vectors
	leaves := tb.collectLeafNodes(tree)
	if len(leaves) == 0 {
		return
	}

	// Build tree bottom-up
	currentLevel := 0
	currentNodes := leaves

	for len(currentNodes) > tb.config.ClusterMin && currentLevel < tb.config.MaxLevel {
		// Cluster current level nodes
		clusters := tb.clusterNodes(currentNodes)

		// Create parent nodes for each cluster
		parents := make([]*RaptorNode, 0, len(clusters))
		for _, cluster := range clusters {
			parent := tb.createParentNode(tree, cluster, currentLevel, embedFn)
			if parent != nil {
				parents = append(parents, parent)
				tree.Internal = append(tree.Internal, parent.ID)
			}
		}

		// Move to next level
		currentNodes = parents
		currentLevel++
	}

	// If we have multiple top-level nodes, create a root
	if len(currentNodes) > 1 {
		root := tb.createRootNode(tree, currentNodes, embedFn)
		if root != nil {
			tree.RootID = root.ID
			tree.Internal = append(tree.Internal, root.ID)
		}
	} else if len(currentNodes) == 1 {
		tree.RootID = currentNodes[0].ID
	}
}

// collectLeafNodes returns leaf nodes that have vectors.
func (tb *TreeBuilder) collectLeafNodes(tree *RaptorTree) []*RaptorNode {
	leaves := make([]*RaptorNode, 0, len(tree.Leaves))
	for _, id := range tree.Leaves {
		node := tree.Nodes[id]
		if node != nil && len(node.Vector) > 0 {
			leaves = append(leaves, node)
		}
	}
	return leaves
}

// clusterNodes groups nodes by vector similarity using k-means.
func (tb *TreeBuilder) clusterNodes(nodes []*RaptorNode) [][]*RaptorNode {
	if len(nodes) <= tb.config.ClusterMin {
		return [][]*RaptorNode{nodes}
	}

	// Determine number of clusters
	k := tb.config.ClusterK
	if k <= 0 {
		k = 4
	}
	maxK := len(nodes) / tb.config.ClusterMin
	if maxK < 2 {
		maxK = 2
	}
	if k > maxK {
		k = maxK
	}

	// Run k-means
	return tb.kMeans(nodes, k)
}

// kMeans performs k-means clustering on node vectors.
func (tb *TreeBuilder) kMeans(nodes []*RaptorNode, k int) [][]*RaptorNode {
	if len(nodes) == 0 || k <= 0 {
		return nil
	}

	n := len(nodes)
	if k >= n {
		// Each node is its own cluster
		clusters := make([][]*RaptorNode, n)
		for i, node := range nodes {
			clusters[i] = []*RaptorNode{node}
		}
		return clusters
	}

	// Get dimension from first node
	dim := len(nodes[0].Vector)

	// Initialize centroids using k-means++
	centroids := tb.initCentroids(nodes, k, dim)

	// Assign nodes to clusters
	clusters := make([][]*RaptorNode, k)
	for iter := 0; iter < 100; iter++ {
		// Clear clusters
		for i := range clusters {
			clusters[i] = clusters[i][:0]
		}

		// Assign each node to nearest centroid
		for _, node := range nodes {
			nearest := tb.nearestCentroid(node.Vector, centroids)
			clusters[nearest] = append(clusters[nearest], node)
		}

		// Update centroids
		newCentroids := make([][]float32, k)
		for i, cluster := range clusters {
			if len(cluster) > 0 {
				newCentroids[i] = tb.meanVector(cluster, dim)
			} else {
				newCentroids[i] = centroids[i]
			}
		}

		// Check convergence
		if tb.centroidsConverged(centroids, newCentroids) {
			break
		}
		centroids = newCentroids
	}

	// Filter out empty clusters
	result := make([][]*RaptorNode, 0, k)
	for _, cluster := range clusters {
		if len(cluster) > 0 {
			result = append(result, cluster)
		}
	}

	return result
}

// initCentroids initializes centroids using k-means++.
func (tb *TreeBuilder) initCentroids(nodes []*RaptorNode, k, dim int) [][]float32 {
	centroids := make([][]float32, k)

	// First centroid: random
	centroids[0] = make([]float32, dim)
	copy(centroids[0], nodes[rand.Intn(len(nodes))].Vector)

	// Remaining centroids: weighted by distance
	for i := 1; i < k; i++ {
		centroids[i] = make([]float32, dim)

		// Compute distances to nearest centroid
		distances := make([]float64, len(nodes))
		totalDist := 0.0
		for j, node := range nodes {
			minDist := math.MaxFloat64
			for c := 0; c < i; c++ {
				d := float64(cosineDistance(node.Vector, centroids[c]))
				if d < minDist {
					minDist = d
				}
			}
			distances[j] = minDist * minDist
			totalDist += distances[j]
		}

		// Weighted random selection
		r := rand.Float64() * totalDist
		cumDist := 0.0
		for j, d := range distances {
			cumDist += d
			if cumDist >= r {
				copy(centroids[i], nodes[j].Vector)
				break
			}
		}
	}

	return centroids
}

// nearestCentroid returns the index of the nearest centroid.
func (tb *TreeBuilder) nearestCentroid(vec []float32, centroids [][]float32) int {
	minDist := float64(math.MaxFloat32)
	nearest := 0
	for i, centroid := range centroids {
		d := float64(cosineDistance(vec, centroid))
		if d < minDist {
			minDist = d
			nearest = i
		}
	}
	return nearest
}

// meanVector computes the mean vector of a cluster.
func (tb *TreeBuilder) meanVector(nodes []*RaptorNode, dim int) []float32 {
	mean := make([]float32, dim)
	for _, node := range nodes {
		for i, v := range node.Vector {
			mean[i] += v
		}
	}
	n := float32(len(nodes))
	for i := range mean {
		mean[i] /= n
	}
	return mean
}

// centroidsConverged checks if centroids have converged.
func (tb *TreeBuilder) centroidsConverged(old, new [][]float32) bool {
	for i := range old {
		if cosineDistance(old[i], new[i]) > 0.001 {
			return false
		}
	}
	return true
}

// createParentNode creates an internal node from a cluster of children.
func (tb *TreeBuilder) createParentNode(tree *RaptorTree, children []*RaptorNode, level int, embedFn func(text string) []float32) *RaptorNode {
	if len(children) == 0 {
		return nil
	}

	// Extractive summary: concatenate representative texts
	summary := tb.extractiveSummary(children)

	// Get embedding
	var vec []float32
	if embedFn != nil {
		vec = embedFn(summary)
	} else {
		// Use mean of child vectors
		vec = tb.meanVector(children, len(children[0].Vector))
	}

	// Create parent node
	parentID := uint32(len(tree.Nodes)) + 1 // Simple ID assignment
	parent := &RaptorNode{
		ID:       parentID,
		DocID:    children[0].DocID, // All children should be from same doc
		Type:     NodeTypeInternal,
		Level:    level + 1,
		Text:     summary,
		Vector:   vec,
		ChildIDs: make([]uint32, len(children)),
	}

	// Set child IDs and update children's parent
	for i, child := range children {
		parent.ChildIDs[i] = child.ID
		child.ParentID = parent.ID
	}

	tree.Nodes[parentID] = parent
	return parent
}

// createRootNode creates a root node from top-level nodes.
func (tb *TreeBuilder) createRootNode(tree *RaptorTree, children []*RaptorNode, embedFn func(text string) []float32) *RaptorNode {
	if len(children) == 0 {
		return nil
	}

	summary := tb.extractiveSummary(children)

	var vec []float32
	if embedFn != nil {
		vec = embedFn(summary)
	} else {
		vec = tb.meanVector(children, len(children[0].Vector))
	}

	rootID := uint32(len(tree.Nodes)) + 1
	root := &RaptorNode{
		ID:       rootID,
		DocID:    children[0].DocID,
		Type:     NodeTypeRoot,
		Level:    children[0].Level + 1,
		Text:     summary,
		Vector:   vec,
		ChildIDs: make([]uint32, len(children)),
	}

	for i, child := range children {
		root.ChildIDs[i] = child.ID
		child.ParentID = root.ID
	}

	tree.Nodes[rootID] = root
	return root
}

// extractiveSummary creates a summary by selecting representative sentences.
func (tb *TreeBuilder) extractiveSummary(nodes []*RaptorNode) string {
	// Simple approach: take first N chars from each node, sorted by "importance"
	// In production, this would use a proper extractive summarizer

	// Sort nodes by text length (longer = more informative)
	sorted := make([]*RaptorNode, len(nodes))
	copy(sorted, nodes)
	sort.Slice(sorted, func(i, j int) bool {
		return len(sorted[i].Text) > len(sorted[j].Text)
	})

	// Take up to 500 chars from top nodes
	maxLen := 500
	var result []byte
	for _, node := range sorted {
		if len(result) >= maxLen {
			break
		}
		if len(result) > 0 {
			result = append(result, ' ')
		}
		remaining := maxLen - len(result)
		if remaining > len(node.Text) {
			remaining = len(node.Text)
		}
		result = append(result, node.Text[:remaining]...)
	}

	return string(result)
}

// cosineDistance returns 1 - cosine similarity.
func cosineDistance(a, b []float32) float32 {
	if len(a) != len(b) {
		return float32(math.MaxFloat32)
	}

	var dot, normA, normB float32
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	if normA == 0 || normB == 0 {
		return float32(math.MaxFloat32)
	}

	similarity := dot / (float32(math.Sqrt(float64(normA))) * float32(math.Sqrt(float64(normB))))
	return 1 - similarity
}
