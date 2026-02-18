package knowledge_test

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/knowledge"
	"github.com/stretchr/testify/assert"
)

func TestGraphTraversal(t *testing.T) {
	g := knowledge.NewGraph()

	// Setup hierarchy:
	// Root -> FolderA -> Note1
	// Root -> FolderB
	// Note1 -> Note2 (Related)

	root := &knowledge.KnowledgeNode{ID: "root", Kind: knowledge.KindUniverse}
	folderA := &knowledge.KnowledgeNode{ID: "folderA", Kind: knowledge.KindGalaxy}
	folderB := &knowledge.KnowledgeNode{ID: "folderB", Kind: knowledge.KindGalaxy}
	note1 := &knowledge.KnowledgeNode{ID: "note1", Kind: knowledge.KindWorld}
	note2 := &knowledge.KnowledgeNode{ID: "note2", Kind: knowledge.KindWorld}

	g.AddNode(root)
	g.AddNode(folderA)
	g.AddNode(folderB)
	g.AddNode(note1)
	g.AddNode(note2)

	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "root", TargetID: "folderA", Relation: knowledge.RelContains})
	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "root", TargetID: "folderB", Relation: knowledge.RelContains})
	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "folderA", TargetID: "note1", Relation: knowledge.RelContains})
	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "note1", TargetID: "note2", Relation: knowledge.RelRelated})

	// 1. GetChildren
	children := g.GetChildren("root", knowledge.RelContains)
	assert.Len(t, children, 2)

	// 2. GetParents
	parents := g.GetParents("note1", knowledge.RelContains)
	assert.Len(t, parents, 1)
	assert.Equal(t, "folderA", parents[0].ID)

	// 3. GetDescendants (Hierarchy)
	descendants := g.GetDescendants("root", knowledge.RelContains, -1)
	// Should find folderA, folderB, note1. note2 is linked by RELATED, so not a descendant via CONTAINS.
	assert.Len(t, descendants, 3)

	// 4. GetAncestors
	ancestors := g.GetAncestors("note1", knowledge.RelContains, -1)
	// Should find folderA, root
	assert.Len(t, ancestors, 2)

	// 5. Neighborhood
	neighbors := g.GetNeighborhood("note1")
	// folderA (parent), note2 (child via related)
	assert.Len(t, neighbors, 2)
}
