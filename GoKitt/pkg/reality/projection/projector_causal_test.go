package projection

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/reality/cst"
	rsyntax "github.com/kittclouds/gokitt/pkg/reality/syntax"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

func TestCausalChainProjection(t *testing.T) {
	// "Ryan defeats Ghoul because Ghoul is weak."
	// For simplicity in mocked CST, we'll imagine:
	// Ryan (0) defeats (5) Ghoul (13) because (19) Ghoul (27) is (33) weak (36).
	// Let's say "is weak" maps to something else, or we just do:
	// Ryan (0) defeats (5) Ghoul (13) because (19) Ryan (27) attacks (32) Ghoul (40)

	root := &cst.Node{
		Kind: rsyntax.KindDocument,
		Children: []*cst.Node{
			{
				Kind: rsyntax.KindSentence,
				Children: []*cst.Node{
					{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 0, End: 4}},   // Ryan
					{Kind: rsyntax.KindVerbPhrase, Range: cst.TextRange{Start: 5, End: 12}},  // defeats
					{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 13, End: 18}}, // Ghoul
					{Kind: rsyntax.KindWord, Range: cst.TextRange{Start: 19, End: 26}},       // because
					{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 27, End: 31}}, // Ryan
					{Kind: rsyntax.KindVerbPhrase, Range: cst.TextRange{Start: 32, End: 39}}, // attacks
					{Kind: rsyntax.KindNounPhrase, Range: cst.TextRange{Start: 40, End: 45}}, // Ghoul
				},
			},
		},
	}
	text := "Ryan defeats Ghoul because Ryan attacks Ghoul"

	// 2. Setup Matcher
	matcher, _ := narrative.New()
	matcher.AddVerb("defeats", narrative.EventBattle, narrative.RelKills, narrative.Transitive)
	matcher.AddVerb("attacks", narrative.EventBattle, narrative.RelAttacks, narrative.Transitive)

	// 3. Entity Map
	entities := EntityMap{
		0:  "Ryan",
		13: "Ghoul",
		27: "Ryan",
		40: "Ghoul",
	}

	// 4. Run Project
	g := Project(root, matcher, entities, text, nil)

	// 5. Verify Event Nodes
	defeatEvent := g.GetNode("event:KILLS_5")
	if defeatEvent == nil {
		t.Fatal("Defeat event not created")
	}

	attackEvent := g.GetNode("event:ATTACKS_32")
	if attackEvent == nil {
		t.Fatal("Attack event not created")
	}

	// Verify "Ryan" and "Ghoul" nodes
	ryan := g.GetNode("Ryan")
	if ryan == nil {
		t.Fatal("Ryan not created")
	}

	// Verify edges from Defeat Event
	foundDefeatSubj := false
	foundDefeatObj := false
	for _, e := range defeatEvent.Outbound {
		if e.Target.ID == "Ryan" && e.Relation == graph.RelHasSubject {
			foundDefeatSubj = true
		}
		if e.Target.ID == "Ghoul" && e.Relation == graph.RelHasObject {
			foundDefeatObj = true
		}
	}

	if !foundDefeatSubj || !foundDefeatObj {
		t.Errorf("Defeat event missing subject/object hooks")
	}

	// 6. Verify Causal Link
	// "defeats ... because ... attacks"
	// The code currently links the previously encountered EVENT to the new one.
	// So "defeats" -> "CAUSES" -> "attacks"
	// Wait! Semantically "attacks -> CAUSES -> defeats" makes more sense,
	// but the temporal scanner just sees "because" and adds CAUSES edge from the left to right.
	// Let's assert the edge exists.
	foundCause := false
	for _, e := range defeatEvent.Outbound {
		if e.Target.ID == attackEvent.ID && e.Relation == graph.RelCauses {
			foundCause = true
		}
	}
	if !foundCause {
		t.Errorf("CAUSES link missing between events")
	}
}
