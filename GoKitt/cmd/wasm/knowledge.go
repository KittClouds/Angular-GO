//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"syscall/js"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/kittclouds/gokitt/internal/graphstore"
	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/knowledge"
)

// Global Knowledge Graph instance (SQLite backed).
var knowledgeGraph *graphstore.SQLiteStore[knowledge.KnowledgeNode]

// Helper to generate stable UUIDs from string IDs.
func toUUID(id string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(id))
}

// knowledgeInit initializes the persistent graph store.
func knowledgeInit(this js.Value, args []js.Value) interface{} {
	fmt.Println("[GoKitt] Knowledge Graph initializing (SQLite-backed)...")

	if sqlStore == nil {
		return ErrorResult("unified store not initialized")
	}

	db := sqlStore.GetDB()
	if db == nil {
		return ErrorResult("failed to get underlying DB")
	}

	if err := graphstore.Migrate(context.Background(), db); err != nil {
		return ErrorResult("failed to migrate graph store: " + err.Error())
	}

	knowledgeGraph = graphstore.NewJSON[knowledge.KnowledgeNode](db)

	fmt.Println("[GoKitt] Knowledge Graph initialized")
	return SuccessResult("knowledge graph initialized")
}

// knowledgeLoad remains as a compatibility alias for the canonical sync path.
func knowledgeLoad(this js.Value, args []js.Value) interface{} {
	return knowledgeSync(this, args)
}

// knowledgeSync projects canonical entities and edges from the unified store
// into the graphstore used by visualization and traversal.
func knowledgeSync(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if sqlStore == nil {
		return ErrorResult("store not initialized")
	}

	fmt.Println("[GoKitt] Syncing knowledge graph from Unified Store...")

	nodeCount, edgeCount, err := syncKnowledgeGraphFromStore()
	if err != nil {
		return ErrorResult("failed to sync knowledge graph: " + err.Error())
	}

	fmt.Printf("[GoKitt] Synced %d nodes and %d edges\n", nodeCount, edgeCount)
	return SuccessResult(fmt.Sprintf("synced %d nodes, %d edges", nodeCount, edgeCount))
}

// knowledgeSave is a no-op because the graphstore is already persistent.
func knowledgeSave(this js.Value, args []js.Value) interface{} {
	return SuccessResult("graph is persistent, save not required")
}

// knowledgeAddNode adds or updates a node directly in the graphstore.
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

	uid := toUUID(node.ID)
	props := graph.VertexProperties{
		Attributes: buildKnowledgeNodeAttributes(node),
	}

	err := knowledgeGraph.AddVertex(uid, node, props)
	if err == graph.ErrVertexAlreadyExists {
		err = knowledgeGraph.UpdateVertex(uid, node, props)
	}
	if err != nil {
		return ErrorResult("failed to add/update node: " + err.Error())
	}

	return SuccessResult("node added: " + node.ID)
}

// knowledgeAddEdge adds or updates a directed edge in the graphstore.
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

	srcUID := toUUID(edge.SourceID)
	tgtUID := toUUID(edge.TargetID)
	props := graph.Edge[uuid.UUID]{
		Properties: graph.EdgeProperties{
			Attributes: buildKnowledgeEdgeAttributes(edge),
			Weight:     graphWeightFromFloat64(edge.Weight),
		},
	}

	err := knowledgeGraph.AddEdge(srcUID, tgtUID, props)
	if err == graph.ErrEdgeAlreadyExists {
		err = knowledgeGraph.UpdateEdge(srcUID, tgtUID, props)
	}
	if err != nil {
		return ErrorResult("failed to add edge: " + err.Error())
	}

	return SuccessResult(fmt.Sprintf("edge added: %s -> %s", edge.SourceID, edge.TargetID))
}

// knowledgeGetNode retrieves a node by ID.
func knowledgeGetNode(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	uid := toUUID(id)

	node, _, err := knowledgeGraph.Vertex(uid)
	if err != nil {
		return ErrorResult("node not found")
	}

	bytes, _ := json.Marshal(node)
	return string(bytes)
}

// knowledgeGetNeighborhood returns immediate neighbors via traversal.
func knowledgeGetNeighborhood(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	uid := toUUID(id)

	ch := knowledgeGraph.Traverse(context.Background(), graphstore.TraversalOptions{
		Root:      uid,
		Direction: graphstore.DirectionBoth,
		MaxDepth:  1,
	})

	var neighbors []knowledge.KnowledgeNode
	for res := range ch {
		if len(res.Path) == 0 {
			continue
		}
		nodeID := res.Path[len(res.Path)-1]
		if nodeID == uid {
			continue
		}

		val, _, err := knowledgeGraph.Vertex(nodeID)
		if err == nil {
			neighbors = append(neighbors, val)
		}
	}

	bytes, _ := json.Marshal(neighbors)
	return string(bytes)
}

// knowledgeGetGraph returns the entire knowledge graph dump.
func knowledgeGetGraph(this js.Value, args []js.Value) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}

	nodes, edges, err := dumpKnowledgeGraph()
	if err != nil {
		return ErrorResult("failed to dump knowledge graph: " + err.Error())
	}

	data := struct {
		Nodes map[string]knowledge.KnowledgeNode `json:"nodes"`
		Edges []knowledge.KnowledgeEdge          `json:"edges"`
	}{
		Nodes: nodes,
		Edges: edges,
	}

	bytes, _ := json.Marshal(data)
	return string(bytes)
}

// knowledgeGetChildren returns children of a node.
func knowledgeGetChildren(this js.Value, args []js.Value) interface{} {
	return traverseRelation(args, graphstore.DirectionOutbound)
}

// knowledgeGetParents returns parents of a node.
func knowledgeGetParents(this js.Value, args []js.Value) interface{} {
	return traverseRelation(args, graphstore.DirectionInbound)
}

func traverseRelation(args []js.Value, dir graphstore.TraversalDirection) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	uid := toUUID(id)

	relation := ""
	if len(args) > 1 {
		relation = args[1].String()
	}

	ch := knowledgeGraph.Traverse(context.Background(), graphstore.TraversalOptions{
		Root:      uid,
		Direction: dir,
		MaxDepth:  1,
	})

	var results []knowledge.KnowledgeNode
	for res := range ch {
		if len(res.Path) == 0 {
			continue
		}
		nodeID := res.Path[len(res.Path)-1]
		if nodeID == uid {
			continue
		}

		val, _, _ := knowledgeGraph.Vertex(nodeID)

		if relation == "" {
			results = append(results, val)
			continue
		}

		e, err := knowledgeGraph.Edge(uid, nodeID)
		if err != nil {
			e, err = knowledgeGraph.Edge(nodeID, uid)
		}
		if err == nil {
			if rel, ok := e.Properties.Attributes["relation"]; ok && rel == relation {
				results = append(results, val)
			}
		}
	}

	bytes, _ := json.Marshal(results)
	return string(bytes)
}

// knowledgeGetAncestors returns ancestors (recursive parents).
func knowledgeGetAncestors(this js.Value, args []js.Value) interface{} {
	return traverseRecursive(args, graphstore.DirectionInbound)
}

// knowledgeGetDescendants returns descendants (recursive children).
func knowledgeGetDescendants(this js.Value, args []js.Value) interface{} {
	return traverseRecursive(args, graphstore.DirectionOutbound)
}

func traverseRecursive(args []js.Value, dir graphstore.TraversalDirection) interface{} {
	if knowledgeGraph == nil {
		return ErrorResult("knowledge graph not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: id")
	}

	id := args[0].String()
	uid := toUUID(id)

	maxDepth := 10
	if len(args) > 2 {
		maxDepth = args[2].Int()
	}

	ch := knowledgeGraph.Traverse(context.Background(), graphstore.TraversalOptions{
		Root:      uid,
		Direction: dir,
		MaxDepth:  maxDepth,
	})

	var results []knowledge.KnowledgeNode
	for res := range ch {
		if len(res.Path) == 0 {
			continue
		}
		nodeID := res.Path[len(res.Path)-1]
		if nodeID == uid {
			continue
		}

		val, _, _ := knowledgeGraph.Vertex(nodeID)
		results = append(results, val)
	}

	bytes, _ := json.Marshal(results)
	return string(bytes)
}

func syncKnowledgeGraphFromStore() (int, int, error) {
	entities, err := sqlStore.ListEntities("")
	if err != nil {
		return 0, 0, fmt.Errorf("list entities: %w", err)
	}

	nodeCount := 0
	entityIDs := make(map[string]bool, len(entities))
	for _, entity := range entities {
		if entity == nil {
			continue
		}

		entityIDs[entity.ID] = true

		node := buildKnowledgeNodeFromEntity(entity)
		uid := toUUID(node.ID)
		props := graph.VertexProperties{
			Attributes: buildKnowledgeNodeAttributes(node),
		}

		err := knowledgeGraph.AddVertex(uid, node, props)
		if err == graph.ErrVertexAlreadyExists {
			err = knowledgeGraph.UpdateVertex(uid, node, props)
		}
		if err != nil {
			return 0, 0, fmt.Errorf("upsert vertex %q: %w", node.ID, err)
		}
		nodeCount++
	}

	edgeSet := make(map[string]*store.Edge)
	for _, entity := range entities {
		if entity == nil {
			continue
		}

		edges, err := sqlStore.ListEdgesForEntity(entity.ID)
		if err != nil {
			return 0, 0, fmt.Errorf("list edges for entity %q: %w", entity.ID, err)
		}

		for _, edge := range edges {
			if edge == nil {
				continue
			}
			key := fmt.Sprintf("%s|%s|%s", edge.SourceID, edge.RelType, edge.TargetID)
			if _, exists := edgeSet[key]; !exists {
				edgeSet[key] = edge
			}
		}
	}

	edgeCount := 0
	for _, edgeRecord := range edgeSet {
		if !entityIDs[edgeRecord.SourceID] || !entityIDs[edgeRecord.TargetID] {
			continue
		}

		edge := buildKnowledgeEdgeFromStoreEdge(edgeRecord)
		props := graph.Edge[uuid.UUID]{
			Properties: graph.EdgeProperties{
				Attributes: buildKnowledgeEdgeAttributes(edge),
				Weight:     graphWeightFromFloat64(edge.Weight),
			},
		}

		srcUID := toUUID(edge.SourceID)
		tgtUID := toUUID(edge.TargetID)
		err := knowledgeGraph.AddEdge(srcUID, tgtUID, props)
		if err == graph.ErrEdgeAlreadyExists {
			err = knowledgeGraph.UpdateEdge(srcUID, tgtUID, props)
		}
		if err != nil {
			return 0, 0, fmt.Errorf("upsert edge %q->%q (%s): %w", edge.SourceID, edge.TargetID, edge.Relation, err)
		}
		edgeCount++
	}

	return nodeCount, edgeCount, nil
}

func dumpKnowledgeGraph() (map[string]knowledge.KnowledgeNode, []knowledge.KnowledgeEdge, error) {
	uids, err := knowledgeGraph.ListVertices()
	if err != nil {
		return nil, nil, fmt.Errorf("list vertices: %w", err)
	}

	nodes := make(map[string]knowledge.KnowledgeNode, len(uids))
	uuidToNode := make(map[uuid.UUID]knowledge.KnowledgeNode, len(uids))
	for _, vertexID := range uids {
		val, _, err := knowledgeGraph.Vertex(vertexID)
		if err != nil {
			return nil, nil, fmt.Errorf("load vertex %q: %w", vertexID.String(), err)
		}
		nodes[val.ID] = val
		uuidToNode[vertexID] = val
	}

	rawEdges, err := knowledgeGraph.ListEdges()
	if err != nil {
		return nil, nil, fmt.Errorf("list edges: %w", err)
	}

	edges := make([]knowledge.KnowledgeEdge, 0, len(rawEdges))
	for _, raw := range rawEdges {
		sourceNode, ok := uuidToNode[raw.Source]
		if !ok {
			val, _, err := knowledgeGraph.Vertex(raw.Source)
			if err != nil {
				return nil, nil, fmt.Errorf("resolve edge source %q: %w", raw.Source.String(), err)
			}
			sourceNode = val
			uuidToNode[raw.Source] = val
		}

		targetNode, ok := uuidToNode[raw.Target]
		if !ok {
			val, _, err := knowledgeGraph.Vertex(raw.Target)
			if err != nil {
				return nil, nil, fmt.Errorf("resolve edge target %q: %w", raw.Target.String(), err)
			}
			targetNode = val
			uuidToNode[raw.Target] = val
		}

		weight := float64(raw.Properties.Weight)
		if confidence, ok := raw.Properties.Attributes["confidence"]; ok {
			if parsed, err := strconv.ParseFloat(confidence, 64); err == nil {
				weight = parsed
			}
		}

		props := make(map[string]interface{})
		for key, value := range raw.Properties.Attributes {
			switch key {
			case "relation", "type", "confidence":
				continue
			default:
				props[key] = value
			}
		}
		if len(props) == 0 {
			props = nil
		}

		relation := raw.Properties.Attributes["relation"]
		if relation == "" {
			relation = raw.Properties.Attributes["type"]
		}
		if relation == "" {
			relation = knowledge.RelRelated
		}

		edges = append(edges, knowledge.KnowledgeEdge{
			SourceID: sourceNode.ID,
			TargetID: targetNode.ID,
			Relation: relation,
			Weight:   weight,
			Props:    props,
		})
	}

	return nodes, edges, nil
}

func buildKnowledgeNodeFromEntity(entity *store.Entity) knowledge.KnowledgeNode {
	node := knowledge.KnowledgeNode{
		ID:    entity.ID,
		Kind:  entity.Kind,
		Label: entity.Label,
		Props: make(map[string]interface{}),
	}
	if len(entity.Aliases) > 0 {
		node.Props["aliases"] = append([]string{}, entity.Aliases...)
	}
	if entity.NarrativeID != "" {
		node.Props["narrativeId"] = entity.NarrativeID
	}
	if entity.FirstNote != "" {
		node.Props["firstNote"] = entity.FirstNote
	}
	if entity.CreatedBy != "" {
		node.Props["createdBy"] = entity.CreatedBy
	}
	if len(node.Props) == 0 {
		node.Props = nil
	}
	return node
}

func buildKnowledgeNodeAttributes(node knowledge.KnowledgeNode) map[string]string {
	attrs := map[string]string{
		"label": node.Label,
		"kind":  node.Kind,
	}
	for key, value := range node.Props {
		attrs[key] = fmt.Sprintf("%v", value)
	}
	return attrs
}

func buildKnowledgeEdgeFromStoreEdge(edge *store.Edge) knowledge.KnowledgeEdge {
	props := make(map[string]interface{})
	if edge.SourceNote != "" {
		props["sourceNote"] = edge.SourceNote
	}
	if edge.Bidirectional {
		props["bidirectional"] = "true"
	}
	if len(props) == 0 {
		props = nil
	}

	return knowledge.KnowledgeEdge{
		SourceID: edge.SourceID,
		TargetID: edge.TargetID,
		Relation: edge.RelType,
		Weight:   edge.Confidence,
		Props:    props,
	}
}

func buildKnowledgeEdgeAttributes(edge knowledge.KnowledgeEdge) map[string]string {
	attrs := map[string]string{
		"relation":   edge.Relation,
		"type":       edge.Relation,
		"confidence": strconv.FormatFloat(edge.Weight, 'f', -1, 64),
	}
	for key, value := range edge.Props {
		attrs[key] = fmt.Sprintf("%v", value)
	}
	return attrs
}

func graphWeightFromFloat64(weight float64) int {
	switch {
	case weight <= 0:
		return 1
	case weight < 1:
		return int(weight*1000 + 0.5)
	default:
		return int(weight + 0.5)
	}
}
