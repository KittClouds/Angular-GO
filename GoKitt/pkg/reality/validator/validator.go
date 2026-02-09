package validator

import (
	"strings"

	"github.com/kittclouds/gokitt/pkg/reality/cst"
	"github.com/kittclouds/gokitt/pkg/reality/syntax"
)

// LLMRelation mirrors the JSON structure from the TS service
type LLMRelation struct {
	Subject        string  `json:"subject"`
	Object         string  `json:"object"`
	Verb           string  `json:"verb"`
	RelationType   string  `json:"relationType"`
	Confidence     float64 `json:"confidence"`
	SourceSentence string  `json:"sourceSentence"`
}

// ValidatedRelation is a relation grounded in the CST
type ValidatedRelation struct {
	Original    LLMRelation
	SubjectNode *cst.Node // The actual EntitySpan in CST
	ObjectNode  *cst.Node // The actual EntitySpan in CST
	VerbNode    *cst.Node // The VerbPhrase node (optional)
	IsValid     bool
	Issues      []string
}

// Validator validates LLM relations against the CST
type Validator struct {
	root *cst.Node
	text string
}

// New creates a new validator
func New(root *cst.Node, text string) *Validator {
	return &Validator{
		root: root,
		text: text,
	}
}

// Validate cross-references LLM relations with the CST
func (v *Validator) Validate(relations []LLMRelation) []ValidatedRelation {
	var validated []ValidatedRelation

	// 1. Index critical CST nodes for fast lookup
	// Map: "label" -> list of nodes
	entityIndex := make(map[string][]*cst.Node)
	verbIndex := make(map[string][]*cst.Node)

	v.walk(v.root, func(n *cst.Node) {
		txt := strings.ToLower(n.Text(v.text))
		if n.Kind == syntax.KindEntitySpan {
			entityIndex[txt] = append(entityIndex[txt], n)
		} else if n.Kind == syntax.KindVerbPhrase {
			verbIndex[txt] = append(verbIndex[txt], n)
		}
	})

	for _, rel := range relations {
		vr := ValidatedRelation{
			Original: rel,
			IsValid:  true,
		}

		// 2. Find Subject
		subjNodes := findBestMatch(entityIndex, rel.Subject)
		if len(subjNodes) == 0 {
			vr.IsValid = false
			vr.Issues = append(vr.Issues, "Subject not found in CST: "+rel.Subject)
		} else {
			// Basic heuristic: take first for now, improved logic below
			vr.SubjectNode = subjNodes[0]
		}

		// 3. Find Object
		objNodes := findBestMatch(entityIndex, rel.Object)
		if len(objNodes) == 0 {
			vr.IsValid = false
			vr.Issues = append(vr.Issues, "Object not found in CST: "+rel.Object)
		} else {
			vr.ObjectNode = objNodes[0]
		}

		// 4. Validate Proximity (Sentence Window)
		// If we found both nodes, ensure they are relatively close
		if vr.SubjectNode != nil && vr.ObjectNode != nil {
			// Find specific pair closest to each other if multiple existed
			// Refine selection: closest pair in text
			s, o := findClosestPair(subjNodes, objNodes)
			vr.SubjectNode = s
			vr.ObjectNode = o

			dist := abs(s.Range.Start - o.Range.Start)
			if dist > 500 { // Arbitrary "sentence/paragraph" window
				vr.IsValid = false
				vr.Issues = append(vr.Issues, "Subject and Object too far apart (>500 chars)")
			}
		}

		validated = append(validated, vr)
	}

	return validated
}

func (v *Validator) walk(n *cst.Node, fn func(*cst.Node)) {
	fn(n) // visit self
	for _, child := range n.Children {
		v.walk(child, fn)
	}
}

// findBestMatch fuzzy looks up entities (case-insensitive already done in index)
func findBestMatch(index map[string][]*cst.Node, label string) []*cst.Node {
	lower := strings.ToLower(label)

	// Exact match
	if nodes, ok := index[lower]; ok {
		return nodes
	}

	// Partial match (e.g. "Luffy" matches "Monkey D. Luffy")
	var matches []*cst.Node
	for k, nodes := range index {
		if strings.Contains(k, lower) || strings.Contains(lower, k) {
			matches = append(matches, nodes...)
		}
	}
	return matches
}

// findClosestPair finds the Subject/Object node pair with minimum distance
func findClosestPair(subjs, objs []*cst.Node) (*cst.Node, *cst.Node) {
	if len(subjs) == 0 || len(objs) == 0 {
		return nil, nil // Should be handled by caller
	}

	var bestS, bestO *cst.Node
	minDist := 1000000

	for _, s := range subjs {
		for _, o := range objs {
			dist := abs(s.Range.Start - o.Range.Start)
			if dist < minDist {
				minDist = dist
				bestS = s
				bestO = o
			}
		}
	}
	return bestS, bestO
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// FilterValid returns only validated relations that passed all checks
func FilterValid(validated []ValidatedRelation) []ValidatedRelation {
	var valid []ValidatedRelation
	for _, v := range validated {
		if v.IsValid {
			valid = append(valid, v)
		}
	}
	return valid
}

// ValidCount returns count of valid relations
func ValidCount(validated []ValidatedRelation) int {
	count := 0
	for _, v := range validated {
		if v.IsValid {
			count++
		}
	}
	return count
}

// AdjustConfidence boosts/reduces confidence based on CST grounding
// - Found in CST: +0.1 boost
// - Close proximity: +0.05 boost
// - Same sentence: +0.1 boost
// - Not found: -0.3 penalty
func AdjustConfidence(vr *ValidatedRelation) float64 {
	conf := vr.Original.Confidence

	if !vr.IsValid {
		// Heavy penalty for ungrounded relations
		return conf * 0.3
	}

	// Boost for CST grounding
	conf += 0.1

	// Boost for close proximity
	if vr.SubjectNode != nil && vr.ObjectNode != nil {
		dist := abs(vr.SubjectNode.Range.Start - vr.ObjectNode.Range.Start)
		if dist < 100 {
			conf += 0.1 // Same sentence likely
		} else if dist < 200 {
			conf += 0.05
		}
	}

	// Cap at 1.0
	if conf > 1.0 {
		conf = 1.0
	}

	return conf
}

// ToJSON returns the validated relation as JSON-friendly map
func (vr *ValidatedRelation) ToJSON(text string) map[string]interface{} {
	result := map[string]interface{}{
		"subject":        vr.Original.Subject,
		"object":         vr.Original.Object,
		"verb":           vr.Original.Verb,
		"relationType":   vr.Original.RelationType,
		"confidence":     AdjustConfidence(vr),
		"originalConf":   vr.Original.Confidence,
		"sourceSentence": vr.Original.SourceSentence,
		"isValid":        vr.IsValid,
		"issues":         vr.Issues,
	}

	// Add CST position info if grounded
	if vr.SubjectNode != nil {
		result["subjectStart"] = vr.SubjectNode.Range.Start
		result["subjectEnd"] = vr.SubjectNode.Range.End
		result["subjectText"] = vr.SubjectNode.Text(text)
	}
	if vr.ObjectNode != nil {
		result["objectStart"] = vr.ObjectNode.Range.Start
		result["objectEnd"] = vr.ObjectNode.Range.End
		result["objectText"] = vr.ObjectNode.Text(text)
	}

	return result
}
