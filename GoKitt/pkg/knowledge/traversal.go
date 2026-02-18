package knowledge

// -----------------------------------------------------------------------------
// Traversal and Query Logic (Replacing Cozo Datalog)
// -----------------------------------------------------------------------------

// GetChildren returns all nodes that have an inbound edge from parentID with the given relation.
// Datalog: ?[child] := *edges{parent_id: "X", child_id, relation: "CONTAINS"}
func (g *KnowledgeGraph) GetChildren(parentID, relation string) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var children []*KnowledgeNode
	if edges, ok := g.OutboundEdges[parentID]; ok {
		for _, e := range edges {
			if relation == "" || e.Relation == relation {
				if child, exists := g.Nodes[e.TargetID]; exists {
					children = append(children, child)
				}
			}
		}
	}
	return children
}

// GetParents returns all nodes that have an outbound edge to childID with the given relation.
// Datalog: ?[parent] := *edges{parent_id, child_id: "X", relation: "CONTAINS"}
func (g *KnowledgeGraph) GetParents(childID, relation string) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var parents []*KnowledgeNode
	if edges, ok := g.InboundEdges[childID]; ok {
		for _, e := range edges {
			if relation == "" || e.Relation == relation {
				if parent, exists := g.Nodes[e.SourceID]; exists {
					parents = append(parents, parent)
				}
			}
		}
	}
	return parents
}

// GetDescendants returns all descendants via the given relation (e.g., "CONTAINS")
// up to maxDepth (use -1 for infinite).
// Replaces Cozo recursive rule: descendants[id] := children[id] + descendants[children]
func (g *KnowledgeGraph) GetDescendants(rootID, relation string, maxDepth int) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	// Use map to avoid cycles and duplicates
	visited := make(map[string]bool)
	var descendants []*KnowledgeNode

	// Stack for DFS: [NodeID, Depth]
	type element struct {
		id    string
		depth int
	}
	stack := []element{{rootID, 0}}
	visited[rootID] = true

	for len(stack) > 0 {
		curr := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if maxDepth > -1 && curr.depth >= maxDepth {
			continue
		}

		if edges, ok := g.OutboundEdges[curr.id]; ok {
			for _, e := range edges {
				if relation == "" || e.Relation == relation {
					if !visited[e.TargetID] {
						visited[e.TargetID] = true
						if child, exists := g.Nodes[e.TargetID]; exists {
							descendants = append(descendants, child)
							stack = append(stack, element{e.TargetID, curr.depth + 1})
						}
					}
				}
			}
		}
	}

	return descendants
}

// GetAncestors returns all ancestors via the given relation (in reverse, e.g. "CONTAINS" implies Parent->Child).
// So "Ancestors via CONTAINS" means climbing *Inbound* CONTAINS edges.
// Replaces Cozo recursive rule: ancestors[id] := parents[id] + ancestors[parents]
func (g *KnowledgeGraph) GetAncestors(startID, relation string, maxDepth int) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	visited := make(map[string]bool)
	var ancestors []*KnowledgeNode

	stack := []struct {
		id    string
		depth int
	}{{startID, 0}}
	visited[startID] = true

	for len(stack) > 0 {
		curr := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if maxDepth > -1 && curr.depth >= maxDepth {
			continue
		}

		if edges, ok := g.InboundEdges[curr.id]; ok {
			for _, e := range edges {
				// If we look for Ancestors via "CONTAINS", we check inbound edges with "CONTAINS"
				if relation == "" || e.Relation == relation {
					if !visited[e.SourceID] {
						visited[e.SourceID] = true
						if parent, exists := g.Nodes[e.SourceID]; exists {
							ancestors = append(ancestors, parent)
							stack = append(stack, struct {
								id    string
								depth int
							}{e.SourceID, curr.depth + 1})
						}
					}
				}
			}
		}
	}
	return ancestors
}

// GetNeighborhood returns 1-hop neighbors (both inbound and outbound).
func (g *KnowledgeGraph) GetNeighborhood(centerID string) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	visited := make(map[string]bool)
	var neighbors []*KnowledgeNode // Use simple slice, pointer-based iteration is fast
	visited[centerID] = true

	// Outbound
	if edges, ok := g.OutboundEdges[centerID]; ok {
		for _, e := range edges {
			if !visited[e.TargetID] {
				visited[e.TargetID] = true
				if n, exists := g.Nodes[e.TargetID]; exists {
					neighbors = append(neighbors, n)
				}
			}
		}
	}
	// Inbound
	if edges, ok := g.InboundEdges[centerID]; ok {
		for _, e := range edges {
			if !visited[e.SourceID] {
				visited[e.SourceID] = true
				if n, exists := g.Nodes[e.SourceID]; exists {
					neighbors = append(neighbors, n)
				}
			}
		}
	}
	return neighbors
}
