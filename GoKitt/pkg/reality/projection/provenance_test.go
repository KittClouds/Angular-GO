package projection

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/hierarchy"
	"github.com/kittclouds/gokitt/pkg/reality/cst"
	rsyntax "github.com/kittclouds/gokitt/pkg/reality/syntax"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

func TestProjectWithProvenance(t *testing.T) {
	// 1. Setup Mock CST: "Frodo speaks to Sam."
	// Use manual construction to avoid parser dependency complexity in test
	root := &cst.Node{
		Kind: rsyntax.KindDocument,
		Children: []*cst.Node{
			{
				Kind: rsyntax.KindSentence,
				Children: []*cst.Node{
					{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 0, End: 5}},  // Frodo
					{Kind: rsyntax.KindVerbPhrase, Range: cst.TextRange{Start: 6, End: 12}}, // speaks
					{Kind: rsyntax.KindPrepPhrase, Children: []*cst.Node{ // to Sam
						{Kind: rsyntax.KindWord, Range: cst.TextRange{Start: 13, End: 15}},       // to
						{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 16, End: 19}}, // Sam
					}},
				},
			},
		},
	}
	// Add proper text range behavior simulation
	text := "Frodo speaks to Sam"

	// 2. Setup Matcher
	matcher, _ := narrative.New()
	matcher.AddVerb("speaks", narrative.EventDialogue, narrative.RelSpeaksTo, narrative.Transitive)

	// 3. Setup Provenance
	prov := &hierarchy.ProvenanceContext{
		VaultID:    "vault-1",
		WorldID:    "note-123",
		ParentPath: "Folder/Note",
	}

	// 4. Run Project
	g := Project(root, matcher, nil, text, prov)

	// 5. Assert World Node
	worldNode := g.GetNode("world:note-123")
	if worldNode == nil {
		t.Fatal("World node not created")
	}
	if worldNode.Label != "Folder/Note" {
		t.Errorf("Wrong label: got %s", worldNode.Label)
	}

	// 6. Assert Entities Linked to World
	// Projector should have created "Frodo" and "Sam" and linked them
	frodo := g.GetNode("Frodo")
	if frodo == nil {
		t.Fatal("Entity Frodo not created")
	}

	// Check WORLD_CONTAINS link
	linked := false
	for _, edge := range worldNode.Outbound {
		if edge.Target == frodo && edge.Relation == graph.RelWorldContains {
			linked = true
			break
		}
	}
	if !linked {
		t.Error("World -> Frodo link missing")
	}
}
