package main

import (
	"fmt"

	"github.com/kittclouds/gokitt/pkg/knowledge"
)

func main() {
	fmt.Println("Starting Graph Traversal Debug...")
	g := knowledge.NewGraph()

	root := &knowledge.KnowledgeNode{ID: "root", Kind: knowledge.KindUniverse}
	folderA := &knowledge.KnowledgeNode{ID: "folderA", Kind: knowledge.KindGalaxy}
	folderB := &knowledge.KnowledgeNode{ID: "folderB", Kind: knowledge.KindGalaxy}
	note1 := &knowledge.KnowledgeNode{ID: "note1", Kind: knowledge.KindWorld}

	g.AddNode(root)
	g.AddNode(folderA)
	g.AddNode(folderB)
	g.AddNode(note1)

	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "root", TargetID: "folderA", Relation: knowledge.RelContains})
	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "root", TargetID: "folderB", Relation: knowledge.RelContains})
	g.AddEdge(&knowledge.KnowledgeEdge{SourceID: "folderA", TargetID: "note1", Relation: knowledge.RelContains})

	fmt.Println("Graph built. Testing traversal...")

	children := g.GetChildren("root", knowledge.RelContains)
	fmt.Printf("Children of root: %d (Expected 2)\n", len(children))

	descendants := g.GetDescendants("root", knowledge.RelContains, -1)
	fmt.Printf("Descendants of root: %d (Expected 3)\n", len(descendants))

	for _, d := range descendants {
		fmt.Printf(" - %s\n", d.ID)
	}

	fmt.Println("Done.")
}
