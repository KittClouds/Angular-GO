package discovery

import (
	"unicode"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

// DiscoveryEngine orchestrates the discovery of new entities
type DiscoveryEngine struct {
	Registry *CandidateRegistry
	Scanner  *RelationalScanner
	Matcher  *narrative.NarrativeMatcher // Need this to identify verbs in text
}

// NewEngine creates a new discovery engine
func NewEngine(threshold int, matcher *narrative.NarrativeMatcher) *DiscoveryEngine {
	return &DiscoveryEngine{
		Registry: NewRegistry(threshold),
		Scanner:  NewRelationalScanner(),
		Matcher:  matcher,
	}
}

// ObserveToken records a token occurrence
func (e *DiscoveryEngine) ObserveToken(token string) {
	e.Registry.AddToken(token)
}

// ObserveRelation records a relation and potentially infers target type
func (e *DiscoveryEngine) ObserveRelation(sourceKind implicitmatcher.EntityKind, verbMatch *narrative.VerbMatch, targetToken string) {
	// 1. Infer target kind based on source + event
	inferredKind := e.Scanner.InferTarget(sourceKind, verbMatch.EventClass)

	// 2. Propose inference to registry
	if inferredKind != implicitmatcher.KindOther {
		e.Registry.ProposeInference(targetToken, inferredKind)
	}
}

// DiscoveryCandidate represents a potential entity found by the virus
type DiscoveryCandidate struct {
	Text  string
	Start int
	End   int
	Kind  *implicitmatcher.EntityKind // Optional inferred kind
}

// ScanText is a simple heuristic scanner (The Virus) that looks for patterns in raw text.
// Returns a list of candidates for potential promotion.
func (e *DiscoveryEngine) ScanText(text string) []DiscoveryCandidate {
	var candidates []DiscoveryCandidate
	tokenObjs := implicitmatcher.TokenizeWithOffsets(text)
	if len(tokenObjs) < 3 {
		return candidates
	}

	// Extract raw tokens from text for matching
	tokens := make([]string, len(tokenObjs))
	for i, tok := range tokenObjs {
		if tok.Start < len(text) && tok.End <= len(text) {
			tokens[i] = text[tok.Start:tok.End]
		}
	}

	for i := 0; i < len(tokens)-2; i++ {
		sourceTok := tokens[i]
		verbTok := tokens[i+1]
		targetTok := tokens[i+2]

		// 1. Check Source (Must be Known & Promoted & Have Kind)
		sourceStats := e.Registry.GetStats(sourceTok)
		if sourceStats == nil || sourceStats.Status != StatusPromoted || sourceStats.InferredKind == nil {
			continue
		}

		// 2. Check Target (Must look like a candidate: Capitalized)
		if !isCapitalized(targetTok) {
			continue
		}

		// 3. Check Verb
		verbMatch := e.Matcher.Lookup(verbTok)
		if verbMatch == nil {
			continue
		}

		// 4. Observe Relation & Collect Candidate
		// (Also observe the target token itself to bump its count)
		e.Registry.AddToken(targetTok)
		e.ObserveRelation(*sourceStats.InferredKind, verbMatch, targetTok)

		// Create candidate
		// Note: We need the offset of the TARGET token
		targetObj := tokenObjs[i+2]

		// Infer kind for the candidate
		inferredKind := e.Scanner.InferTarget(*sourceStats.InferredKind, verbMatch.EventClass)
		var kindPtr *implicitmatcher.EntityKind
		if inferredKind != implicitmatcher.KindOther {
			kindPtr = &inferredKind
		}

		// Clean the text (trim punctuation etc)
		_, cleanDisplay, valid := Canonicalize(targetTok)
		if !valid {
			continue
		}

		candidates = append(candidates, DiscoveryCandidate{
			Text:  cleanDisplay,
			Start: targetObj.Start,
			End:   targetObj.End, // Note: End might technically be slightly off if we trimmed trailing chars, but for now full span is safer for highlighting?
			// Actually, if we trim "Kaido." to "Kaido", the Highlight Range should probably exclude the dot?
			// But targetObj.End includes the dot.
			// If we change Text to "Kaido", but Keep Range matching "Kaido.", highlighting might look weird if it includes the dot?
			// But calculating the new End offset from "cleanDisplay" length relative to Start is risky if trimming happened at Start too.
			// Canonicalize trims start and end.
			// Let's assume for Discovery, rough span is fine, or we refine range.
			// Ideally we adjust End.
			Kind: kindPtr,
		})
	}
	return candidates
}

func isCapitalized(s string) bool {
	if s == "" {
		return false
	}
	r := rune(s[0])
	return unicode.IsUpper(r)
}
