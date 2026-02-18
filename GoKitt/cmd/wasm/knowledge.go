//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/knowledge"
)

// Global Knowledge Graph instance
var knowledgeGraph *knowledge.KnowledgeGraph

// knowledgeInit initializes a new in-memory knowledge graph.
// Args: []
func knowledgeInit(this js.Value, args []js.Value) interface{} {
	fmt.Println("[GoKitt] 🧠 Knowledge Graph initializing...")
	knowledgeGraph = knowledge.NewGraph()
	fmt.Println("[GoKitt] 🧠 Knowledge Graph initialized (empty)")
	return SuccessResult("knowledge graph initialized")
}

// knowledgeLoad loads the graph from the persistent SQLite store.
// Loads entities as nodes and edges from the unified SQLite store into the in-memory graph.
func knowledgeLoad(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	fmt.Println("[GoKitt] 📚 Loading knowledge graph from SQLite...")

	// Load entities as nodes
	entities, err := sqlStore.ListEntities("")
	if err != nil {
		return ErrorResult("failed to list entities: " + err.Error())
	}

	nodeCount := 0
	for _, e := range entities {
		node := &knowledge.KnowledgeNode{
			ID:    e.ID,
			Kind:  e.Kind,
			Label: e.Label,
			Props: make(map[string]interface{}),
		}
		// Aliases is already []string in Entity struct
		if len(e.Aliases) > 0 {
			node.Props["aliases"] = e.Aliases
		}
		knowledgeGraph.AddNode(node)
		nodeCount++
	}

	// Load all edges by iterating through entities
	// Note: ListEdgesForEntity returns edges for a specific entity
	// We need to collect all unique edges
	edgeSet := make(map[string]*knowledge.KnowledgeEdge)
	for _, e := range entities {
		edges, err := sqlStore.ListEdgesForEntity(e.ID)
		if err != nil {
			continue
		}
		for _, edge := range edges {
			key := fmt.Sprintf("%s-%s-%s", edge.SourceID, edge.RelType, edge.TargetID)
			if _, exists := edgeSet[key]; !exists {
				edgeSet[key] = &knowledge.KnowledgeEdge{
					SourceID: edge.SourceID,
					TargetID: edge.TargetID,
					Relation: edge.RelType,
					Weight:   edge.Confidence,
					Props:    make(map[string]interface{}),
				}
			}
		}
	}

	edgeCount := 0
	for _, edge := range edgeSet {
		knowledgeGraph.AddEdge(edge)
		edgeCount++
	}

	fmt.Printf("[GoKitt] 📚 Loaded %d nodes and %d edges from SQLite\n", nodeCount, edgeCount)
	return SuccessResult(fmt.Sprintf("loaded %d nodes, %d edges", nodeCount, edgeCount))
}

// knowledgeSave saves the current in-memory graph to SQLite.
// Persists the in-memory graph to the unified SQLite store.
func knowledgeSave(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	fmt.Println("[GoKitt] 💾 Saving knowledge graph to SQLite...")

	nodeCount := 0
	edgeCount := 0

	// Save nodes as entities
	knowledgeGraph.VisitNodes(func(n *knowledge.KnowledgeNode) {
		var aliases []string
		if a, ok := n.Props["aliases"]; ok {
			if arr, ok := a.([]string); ok {
				aliases = arr
			}
		}

		entity := &store.Entity{
			ID:        n.ID,
			Label:     n.Label,
			Kind:      n.Kind,
			Aliases:   aliases,
			CreatedAt: 0,
			UpdatedAt: 0,
		}

		if err := sqlStore.UpsertEntity(entity); err == nil {
			nodeCount++
		}
	})

	// Save edges
	knowledgeGraph.VisitEdges(func(e *knowledge.KnowledgeEdge) {
		edge := &store.Edge{
			ID:         fmt.Sprintf("%s-%s-%s", e.SourceID, e.Relation, e.TargetID),
			SourceID:   e.SourceID,
			TargetID:   e.TargetID,
			RelType:    e.Relation,
			Confidence: e.Weight,
		}

		if err := sqlStore.UpsertEdge(edge); err == nil {
			edgeCount++
		}
	})

	fmt.Printf("[GoKitt] 💾 Saved %d nodes and %d edges to SQLite\n", nodeCount, edgeCount)
	return SuccessResult(fmt.Sprintf("saved %d nodes, %d edges", nodeCount, edgeCount))
}

// knowledgeAddNode adds or updates a node.
// Args: [nodeJSON string]
func knowledgeAddNode(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: nodeJSON")
	}

	var node knowledge.KnowledgeNode
	if err := json.Unmarshal([]byte(args[0].String()), &node); err != nil {
		return ErrorResult("invalid node json: " + err.Error())
	}

	knowledgeGraph.AddNode(&node)
	return SuccessResult("node added: " + node.ID)
}

// knowledgeAddEdge adds a directed edge.
// Args: [edgeJSON string]
func knowledgeAddEdge(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: edgeJSON")
	}

	var edge knowledge.KnowledgeEdge
	if err := json.Unmarshal([]byte(args[0].String()), &edge); err != nil {
		return ErrorResult("invalid edge json: " + err.Error())
	}

	knowledgeGraph.AddEdge(&edge)
	return SuccessResult(fmt.Sprintf("edge added: %s -> %s", edge.SourceID, edge.TargetID))
}

// knowledgeGetNode retrieves a node by ID.
// Args: [id string]
func knowledgeGetNode(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	node, exists := knowledgeGraph.GetNode(id)
	if !exists {
		return ErrorResult("node not found") // Or specific null result?
	}

	bytes, _ := json.Marshal(node)
	return string(bytes)
}

// knowledgeGetChildren returns children of a node.
// Args: [id string, relation string (optional)]
func knowledgeGetChildren(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	relation := ""
	if len(args) > 1 {
		relation = args[1].String()
	}

	children := knowledgeGraph.GetChildren(id, relation)
	bytes, _ := json.Marshal(children)
	return string(bytes)
}

// knowledgeGetParents returns parents of a node.
// Args: [id string, relation string (optional)]
func knowledgeGetParents(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	relation := ""
	if len(args) > 1 {
		relation = args[1].String()
	}

	parents := knowledgeGraph.GetParents(id, relation)
	bytes, _ := json.Marshal(parents)
	return string(bytes)
}

// knowledgeGetAncestors returns ancestors (recursive parents).
// Args: [id string, relation string (optional), maxDepth int (optional)]
func knowledgeGetAncestors(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	relation := ""
	if len(args) > 1 {
		relation = args[1].String()
	}
	maxDepth := -1
	if len(args) > 2 {
		maxDepth = args[2].Int()
	}

	ancestors := knowledgeGraph.GetAncestors(id, relation, maxDepth)
	bytes, _ := json.Marshal(ancestors)
	return string(bytes)
}

// knowledgeGetDescendants returns descendants (recursive children).
// Args: [id string, relation string (optional), maxDepth int (optional)]
func knowledgeGetDescendants(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	relation := ""
	if len(args) > 1 {
		relation = args[1].String()
	}
	maxDepth := -1
	if len(args) > 2 {
		maxDepth = args[2].Int()
	}

	descendants := knowledgeGraph.GetDescendants(id, relation, maxDepth)
	bytes, _ := json.Marshal(descendants)
	return string(bytes)
}

// knowledgeGetNeighborhood returns immediate neighbors (in/out).
// Args: [id string]
func knowledgeGetNeighborhood(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	neighbors := knowledgeGraph.GetNeighborhood(id)
	bytes, _ := json.Marshal(neighbors)
	return string(bytes)
}

// knowledgeGetGraph returns the entire knowledge graph as JSON.
// Args: []
// Returns: JSON object { "nodes": {}, "edges": [] }
func knowledgeGetGraph(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}

	bytes, err := knowledgeGraph.ToJSON()
	if err != nil {
		return ErrorResult("failed to serialize graph: " + err.Error())
	}

	return string(bytes)
}
