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

// ScanText is a simple heuristic scanner (The Virus) that looks for patterns in raw text.
// Uses TokenizeWithOffsets to properly split on punctuation.
func (e *DiscoveryEngine) ScanText(text string) {
	tokenObjs := implicitmatcher.TokenizeWithOffsets(text)
	if len(tokenObjs) < 3 {
		return
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

		// 4. Observe Relation
		// (Also observe the target token itself to bump its count)
		e.Registry.AddToken(targetTok)
		e.ObserveRelation(*sourceStats.InferredKind, verbMatch, targetTok)
	}
}

func isCapitalized(s string) bool {
	if s == "" {
		return false
	}
	r := rune(s[0])
	return unicode.IsUpper(r)
}
