package projection

import (
	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/reality/cst"
	rsyntax "github.com/kittclouds/gokitt/pkg/reality/syntax"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

// EntityResolver maps a text offset (start) to an Entity ID
type EntityMap map[int]string

// Project walks the CST and builds a semantic graph
func Project(root *cst.Node, matcher *narrative.NarrativeMatcher, entities EntityMap, text string) *graph.ConceptGraph {
	g := graph.NewGraph()

	// Recursive walk looking for Sentences
	var walk func(n *cst.Node)
	walk = func(n *cst.Node) {
		if n.Kind == rsyntax.KindSentence {
			processSentence(n, g, matcher, entities, text)
		}

		for _, child := range n.Children {
			walk(child)
		}
	}

	walk(root)
	return g
}

func processSentence(sent *cst.Node, g *graph.ConceptGraph, matcher *narrative.NarrativeMatcher, entities EntityMap, source string) {
	// 1. Flatten children into sequential list of interesting nodes (NP, VP, Entity)
	var nodes []*cst.Node

	var gather func(n *cst.Node)
	gather = func(n *cst.Node) {
		if n.Kind == rsyntax.KindNounPhrase || n.Kind == rsyntax.KindVerbPhrase || n.Kind == rsyntax.KindEntitySpan {
			nodes = append(nodes, n)
			// Don't recurse into phrasal nodes for SVO logic (atomic units)
			return
		}
		for _, c := range n.Children {
			gather(c)
		}
	}
	gather(sent)

	// 2. Iterate VPs to find relations
	for i, n := range nodes {
		if n.Kind == rsyntax.KindVerbPhrase {
			// Analyze Verb
			verbText := n.Text(source)
			match := matcher.Lookup(verbText)

			if match != nil {
				// Find Subject (Left)
				subj := findNearest(nodes, i, -1, rsyntax.KindNounPhrase, rsyntax.KindEntitySpan)
				// Find Object (Right)
				obj := findNearest(nodes, i, 1, rsyntax.KindNounPhrase, rsyntax.KindEntitySpan)

				if subj != nil && obj != nil {
					// Resolve IDs
					subjID := resolveID(subj, entities)
					objID := resolveID(obj, entities)

					// Default to text label if no ID
					if subjID == "" {
						subjID = subj.Text(source)
					}
					if objID == "" {
						objID = obj.Text(source)
					}

					// Add to Graph
					// Assuming generic "Concept" kind for now unless we look up metadata
					g.AddEdgeWithNodes(
						subjID, subjID, "Concept",
						objID, objID, "Concept",
						match.RelationType.String(),
						1.0,
					)
				}
			}
		}
	}
}

func findNearest(nodes []*cst.Node, startIdx int, direction int, targets ...rsyntax.SyntaxKind) *cst.Node {
	curr := startIdx + direction
	for curr >= 0 && curr < len(nodes) {
		k := nodes[curr].Kind
		for _, t := range targets {
			if k == t {
				return nodes[curr]
			}
		}
		curr += direction
	}
	return nil
}

func resolveID(n *cst.Node, entities EntityMap) string {
	// Exact match on start offset?
	if id, ok := entities[n.Range.Start]; ok {
		return id
	}
	// Or check children?
	// If NP contains EntitySpan, we want the EntitySpan's ID.
	// But 'nodes' list flattened things.

	// Heuristic: Check close proximity map?
	// For now, simple exact start match.
	return ""
}
