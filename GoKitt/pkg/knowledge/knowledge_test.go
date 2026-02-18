package knowledge_test

import (
	"encoding/json"
	"testing"

	"github.com/kittclouds/gokitt/pkg/knowledge"
	"github.com/stretchr/testify/assert"
)

func TestKnowledgeGraph(t *testing.T) {
	g := knowledge.NewGraph()

	// 1. Add Nodes
	world := &knowledge.KnowledgeNode{
		ID:    "world-1",
		Kind:  knowledge.KindWorld,
		Label: "My World",
		Props: map[string]interface{}{"tags": []string{"fantasy"}},
	}
	g.AddNode(world)

	concept := &knowledge.KnowledgeNode{
		ID:    "concept-1",
		Kind:  knowledge.KindConcept,
		Label: "Magic",
	}
	g.AddNode(concept)

	// 2. Add Edge
	edge := &knowledge.KnowledgeEdge{
		SourceID: world.ID,
		TargetID: concept.ID,
		Relation: knowledge.RelContains,
		Weight:   1.0,
	}
	g.AddEdge(edge)

	// 3. Verify Node Retrieval
	n, ok := g.GetNode("world-1")
	assert.True(t, ok)
	assert.Equal(t, "My World", n.Label)

	// 4. Verify Edge Retrieval
	edges := g.GetEdges(world.ID, concept.ID, knowledge.RelContains)
	assert.Len(t, edges, 1)

	// 5. Test Filter
	filtered := g.FilterNodes(func(n *knowledge.KnowledgeNode) bool {
		return n.Kind == knowledge.KindConcept
	})
	assert.Len(t, filtered, 1)
	assert.Equal(t, "Magic", filtered[0].Label)

	// 6. Test JSON
	data, err := g.ToJSON()
	assert.NoError(t, err)
	// Verify JSON structure
	var check map[string]interface{}
	err = json.Unmarshal(data, &check)
	assert.NoError(t, err)
	assert.Contains(t, check, "nodes")
	assert.Contains(t, check, "edges")
}
