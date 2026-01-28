package projection

import (
	"strings"

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
	// 1. Flatten children into sequential list
	var nodes []*cst.Node
	var gather func(n *cst.Node)
	gather = func(n *cst.Node) {
		switch n.Kind {
		case rsyntax.KindNounPhrase, rsyntax.KindVerbPhrase, rsyntax.KindEntitySpan, rsyntax.KindPrepPhrase, rsyntax.KindAdjPhrase, rsyntax.KindWord:
			nodes = append(nodes, n)
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
			verbText := n.Text(source)
			match := matcher.Lookup(verbText)

			if match != nil {
				// Find Subject (Left)
				subj := findNearestNP(nodes, i, -1, source)

				// For communication verbs (SPEAKS_TO), look for "to [Name]" pattern first
				var targetID, recipientID string
				var objPP *cst.Node

				relType := match.RelationType.String()
				isCommunication := relType == "SPEAKS_TO" || relType == "MENTIONS" || relType == "REVEALS"

				searchOffset := 1 // Start searching for object at verb + 1

				if isCommunication {
					// 1. Check for "that" (Attribution)
					thatIdx := findToken(nodes, i+1, "that", source, 4) // Look ahead 4 nodes
					if thatIdx != -1 {
						relType = "MENTIONS"
						searchOffset = (thatIdx - i) + 1 // Skip "that"
					}

					// 2. Look for "to [CapitalizedWord]" pattern (Recipient)
					recipient := findRecipient(nodes, i, source)
					if recipient != "" {
						recipientID = recipient
						// If NOT attribution, default target to recipient
						if relType == "SPEAKS_TO" {
							targetID = recipient
						}
					}
				}

				// If target not yet set (or we are in MENTIONS mode looking for content), scan for object
				if targetID == "" {
					obj, pp := findNearestNPWithContainer(nodes, i, searchOffset, source)
					objPP = pp
					if obj != nil {
						objID := resolveID(obj, entities)
						if objID == "" {
							objID = obj.Text(source)
						}
						targetID = objID
					}
				}

				if subj != nil && targetID != "" {
					subjID := resolveID(subj, entities)
					if subjID == "" {
						subjID = subj.Text(source)
					}

					// Extract Modifiers from unused PPs
					var manner, location, time string

					for _, node := range nodes {
						if node.Kind == rsyntax.KindPrepPhrase {
							// Skip if this PP contained the object
							if node == objPP {
								continue
							}

							// Heuristic classification
							ppText := node.Text(source)
							lower := strings.ToLower(ppText)

							if strings.HasPrefix(lower, "with ") {
								manner = strings.TrimPrefix(lower, "with ")
							} else if strings.HasPrefix(lower, "in ") || strings.HasPrefix(lower, "at ") || strings.HasPrefix(lower, "on ") {
								location = ppText
							} else if strings.HasPrefix(lower, "during ") || strings.HasPrefix(lower, "after ") || strings.HasPrefix(lower, "before ") {
								time = ppText
							}
							// Note: "to [X]" for communication is handled separately as recipient
						}
					}

					// Add QuadPlus (with recipient)
					g.AddQuadPlus(
						subjID, subjID, "Concept",
						targetID, targetID, "Concept",
						relType,
						1.0,
						manner, location, time, recipientID,
					)
				}
			}
		}
	}
}

// findRecipient looks for "to [CapitalizedWord]" pattern after a verb
// Returns the name if found, empty string otherwise
func findRecipient(nodes []*cst.Node, verbIdx int, source string) string {
	// Scan nodes after the verb for "to" followed by a capitalized word
	for j := verbIdx + 1; j < len(nodes)-1; j++ {
		n := nodes[j]

		// Check if this is the word "to"
		if n.Kind == rsyntax.KindWord {
			text := n.Text(source)
			if strings.ToLower(text) == "to" {
				// Check next node for capitalized word (may be VerbPhrase due to POS bug)
				next := nodes[j+1]
				nextText := next.Text(source)
				if len(nextText) > 0 && nextText[0] >= 'A' && nextText[0] <= 'Z' {
					// Looks like a proper noun - use as recipient
					return nextText
				}
			}
		}
	}
	return ""
}

// findNearestNPWithContainer looks for NP, checking PPs. Returns (NP, ContainerPP)
func findNearestNPWithContainer(nodes []*cst.Node, startIdx int, direction int, source string) (*cst.Node, *cst.Node) {
	curr := startIdx + direction
	for curr >= 0 && curr < len(nodes) {
		n := nodes[curr]
		switch n.Kind {
		case rsyntax.KindNounPhrase, rsyntax.KindEntitySpan, rsyntax.KindAdjPhrase, rsyntax.KindWord:
			return n, nil
		case rsyntax.KindPrepPhrase:
			np := findNPInPP(n)
			if np != nil {
				return np, n
			}
		}
		curr += direction
	}
	return nil, nil
}

// Wrapper for existing signature
func findNearestNP(nodes []*cst.Node, startIdx int, direction int, source string) *cst.Node {
	np, _ := findNearestNPWithContainer(nodes, startIdx, direction, source)
	return np
}

// findNPInPP searches children of a PrepPhrase for a NounPhrase or noun Word
func findNPInPP(pp *cst.Node) *cst.Node {
	// First, look for explicit NounPhrase or EntitySpan
	for _, child := range pp.Children {
		if child.Kind == rsyntax.KindNounPhrase || child.Kind == rsyntax.KindEntitySpan {
			return child
		}
	}

	// If no NP found, look for Word children (the PP might have flat structure)
	// Return the last Word that's not the preposition (typically the head noun)
	var lastWord *cst.Node
	for _, child := range pp.Children {
		if child.Kind == rsyntax.KindWord {
			lastWord = child
		}
	}
	return lastWord
}

func resolveID(n *cst.Node, entities EntityMap) string {
	// Exact match on start offset?
	if id, ok := entities[n.Range.Start]; ok {
		return id
	}
	// Check children for EntitySpan
	for _, child := range n.Children {
		if id, ok := entities[child.Range.Start]; ok {
			return id
		}
	}
	return ""
}

// findToken looks for a specific token text in the nodes list
func findToken(nodes []*cst.Node, startIdx int, tokenText string, source string, limit int) int {
	end := startIdx + limit
	if end > len(nodes) {
		end = len(nodes)
	}

	for i := startIdx; i < end; i++ {
		n := nodes[i]
		if n.Kind == rsyntax.KindWord {
			text := n.Text(source)
			if strings.ToLower(text) == strings.ToLower(tokenText) {
				return i
			}
		}
	}
	return -1
}
