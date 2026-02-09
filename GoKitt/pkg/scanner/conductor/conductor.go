// Package conductor orchestrates the entire scanning pipeline.
// It wires together Syntax, Implicit, Chunker, Narrative, Resolver, and Discovery.
package conductor

import (
	"strings"
	"unicode"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor/helpers"
	"github.com/kittclouds/gokitt/pkg/scanner/discovery"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
	"github.com/kittclouds/gokitt/pkg/scanner/resolver"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

// ScanResult is the comprehensive result of a scan
type ScanResult struct {
	Text         string
	CleanText    string
	Syntax       []syntax.SyntaxMatch
	Tokens       []chunker.Token
	Chunks       []chunker.Chunk
	Narrative    []NarrativeEvent
	ResolvedRefs []ResolvedReference
}

// NarrativeEvent is a high-level derived event from the scan
type NarrativeEvent struct {
	Event    narrative.EventClass
	Relation narrative.RelationType
	Subject  string // EntityID or "Unknown"
	Object   string // EntityID or "Unknown"
	Range    chunker.TextRange
}

// ResolvedReference maps a text span to an EntityID
type ResolvedReference struct {
	Text     string
	EntityID string
	Range    chunker.TextRange
}

// Conductor manages the scanning pipeline
type Conductor struct {
	syntaxScanner    *syntax.SyntaxScanner
	implicitScanner  *implicitmatcher.RuntimeDictionary
	chunker          *chunker.Chunker
	narrativeMatcher *narrative.NarrativeMatcher
	resolver         *resolver.Resolver
	discoveryEngine  *discovery.DiscoveryEngine
}

// New creates a new Conductor with all sub-components initialized
func New() (*Conductor, error) {
	nm, err := narrative.New()
	if err != nil {
		return nil, err
	}

	// Initialize Discovery Engine (threshold 2 for demo)
	discEngine := discovery.NewEngine(2, nm)

	return &Conductor{
		syntaxScanner:    syntax.New(),
		implicitScanner:  nil, // To be loaded if needed
		chunker:          chunker.New(),
		narrativeMatcher: nm,
		resolver:         resolver.New(),
		discoveryEngine:  discEngine,
	}, nil
}

// SetDictionary loads the implicit scanner dictionary
func (c *Conductor) SetDictionary(dict *implicitmatcher.RuntimeDictionary) {
	c.implicitScanner = dict
}

// GetDictionary returns the Aho-Corasick implicit scanner
func (c *Conductor) GetDictionary() *implicitmatcher.RuntimeDictionary {
	return c.implicitScanner
}

// Scan processes text through all pipeline stages
func (c *Conductor) Scan(text string) ScanResult {
	// 1. Syntax Pass (Explicit Tags/Links)
	synMatches := c.syntaxScanner.Scan(text)
	c.registerExplicitEntities(synMatches)

	// 2. Implicit Matcher Pass (Registry Entities) - Phase 0 Fix
	// This allows entities registered via LLM or manual tagging to be found in prose
	// and create EntitySpan nodes in the CST for relationship extraction.
	if c.implicitScanner != nil {
		implicitHits := c.implicitScanner.ScanWithInfo(text)
		for _, hit := range implicitHits {
			// Skip if this span already has a syntax match (explicit takes priority)
			isOverlapping := false
			for _, syn := range synMatches {
				if (hit.Start >= syn.Start && hit.Start < syn.End) ||
					(hit.End > syn.Start && hit.End <= syn.End) {
					isOverlapping = true
					break
				}
			}
			if isOverlapping {
				continue
			}

			// Use best entity if multiple match same pattern
			bestEntity := c.implicitScanner.SelectBest(func() []string {
				ids := make([]string, 0, len(hit.Entities))
				for _, e := range hit.Entities {
					ids = append(ids, e.ID)
				}
				return ids
			}())

			if bestEntity != nil {
				synMatches = append(synMatches, syntax.SyntaxMatch{
					Start:      hit.Start,
					End:        hit.End,
					Text:       hit.MatchedText,
					Original:   hit.MatchedText,
					Kind:       syntax.KindEntity,
					EntityKind: bestEntity.Kind.String(),
					Label:      bestEntity.Label,
				})

				// Also register with resolver for pronoun resolution
				c.resolver.ObserveMention(bestEntity.Label)
			}
		}
	}

	// 3. Chunker Pass (Structure)
	chunkResult := c.chunker.Chunk(text)

	// 4. Harvest Candidates (All NPs)
	for _, chunk := range chunkResult.Chunks {
		if chunk.Kind == chunker.NounPhrase {
			head := chunk.HeadText(text)
			// Only observe if capitalized (heuristic for Proper Noun)
			if len(head) > 0 {
				first := []rune(head)[0]
				if unicode.IsUpper(first) {
					c.discoveryEngine.ObserveToken(head)
				}
			}
		}
	}

	// 5. Narrative Pass (Verbs -> Events) & Discovery "Virus"
	var narrativeEvents []NarrativeEvent

	for i, chunk := range chunkResult.Chunks {
		if chunk.Kind == chunker.VerbPhrase {
			// Check verb against Narrative FST
			headVerb := chunk.HeadText(text)
			match := c.narrativeMatcher.Lookup(headVerb)

			if match != nil {
				// We found a narrative event!
				// Attempt to find Subject (prev NP) and Object (next NP)
				subjChunk := helpers.FindPrevNP(chunkResult.Chunks, i)
				objChunk := helpers.FindNextNP(chunkResult.Chunks, i)

				subjText := "Unknown"
				objText := "Unknown"

				if subjChunk != nil {
					subjText = subjChunk.HeadText(text)
				}
				if objChunk != nil {
					objText = objChunk.HeadText(text)
				}

				// Run Discovery Logic (Virus)
				if subjChunk != nil && objChunk != nil {
					subjKind := c.resolveKind(subjText)
					// Only propagate from known kinds for now, or assume Character if Proper
					if subjKind != implicitmatcher.KindOther {
						c.discoveryEngine.ObserveRelation(subjKind, match, objText)
					}
				}

				// Resolve Entity IDs for final output
				subjID := c.resolver.Resolve(subjText, nil)
				if subjID == "" {
					subjID = subjText
				}

				objID := c.resolver.Resolve(objText, nil)
				if objID == "" {
					objID = objText
				}

				narrativeEvents = append(narrativeEvents, NarrativeEvent{
					Event:    match.EventClass,
					Relation: match.RelationType,
					Subject:  subjID,
					Object:   objID,
					Range:    chunk.Range,
				})
			}
		}
	}

	// 6. Resolver Pass (Pronouns) - Second pass for remaining tokens
	var resolvedRefs []ResolvedReference
	for _, token := range chunkResult.Tokens {
		if token.POS == chunker.Pronoun || token.POS == chunker.ProperNoun {
			word := token.Text
			if id := c.resolver.Resolve(word, nil); id != "" {
				resolvedRefs = append(resolvedRefs, ResolvedReference{
					Text:     word,
					EntityID: id,
					Range:    token.Range,
				})
			}
		}
	}

	return ScanResult{
		Text:         text,
		CleanText:    text,
		Syntax:       synMatches,
		Tokens:       chunkResult.Tokens,
		Chunks:       chunkResult.Chunks,
		Narrative:    narrativeEvents,
		ResolvedRefs: resolvedRefs,
	}
}

// Close cleans up resources
func (c *Conductor) Close() error {
	return c.narrativeMatcher.Close()
}

// Helpers

func (c *Conductor) registerExplicitEntities(matches []syntax.SyntaxMatch) {
	for _, m := range matches {
		if m.Kind == syntax.KindEntity {
			gender := resolver.GenderUnknown
			k := strings.ToUpper(m.EntityKind)
			if k == "LOCATION" || k == "OBJECT" || k == "ITEM" || k == "MONSTER" {
				gender = resolver.GenderNeutral
			}

			c.resolver.RegisterEntity(resolver.EntityMetadata{
				ID:      m.Label,
				Name:    m.Label,
				Kind:    m.EntityKind,
				Aliases: []string{},
				Gender:  gender,
			})
			c.resolver.ObserveMention(m.Label)

			// Also tell Discovery about it (as PROMOTED + Known Kind)
			c.discoveryEngine.ObserveToken(m.Label)
			// Force set kind in registry
			kind := implicitmatcher.ParseKind(m.EntityKind)
			c.discoveryEngine.Registry.ProposeInference(m.Label, kind)
		}
	}
}

func (c *Conductor) resolveKind(text string) implicitmatcher.EntityKind {
	// 1. Check Resolver/Explicit
	// (Resolver tracks EntityMetadata but not DAFSA Kind directly, needs alignment)
	// For now, assume Character if Proper Noun and unknown

	// 2. Check Discovery Registry
	stats := c.discoveryEngine.Registry.GetStats(text)
	if stats != nil && stats.InferredKind != nil {
		return *stats.InferredKind
	}

	return implicitmatcher.KindCharacter // Aggressive default for demo
}

// GetMatcher returns the narrative matcher for external use (Projection)
func (c *Conductor) GetMatcher() *narrative.NarrativeMatcher {
	return c.narrativeMatcher
}

// GetCandidates returns unrelated candidates from Discovery Engine
func (c *Conductor) GetCandidates() interface{} {
	return c.discoveryEngine.Registry.GetCandidates()
}

// ScanDiscovery runs the full discovery pipeline (Harvester + Virus)
func (c *Conductor) ScanDiscovery(text string) {
	// Phase 1: Harvester - Observe ALL capitalized words
	// Use TokenizeWithOffsets to properly split on punctuation (not just whitespace)
	tokens := implicitmatcher.TokenizeWithOffsets(text)
	for _, tok := range tokens {
		// Check if capitalized in original text (potential entity)
		if tok.Start < len(text) && tok.End <= len(text) {
			rawToken := text[tok.Start:tok.End]
			if len(rawToken) > 0 {
				first := []rune(rawToken)[0]
				if unicode.IsUpper(first) {
					c.discoveryEngine.ObserveToken(rawToken)
				}
			}
		}
	}

	// Phase 2: Virus - Find relational patterns
	c.discoveryEngine.ScanText(text)
}

// SeedDiscovery pre-populates the discovery registry with known entities
// This gives ScanText promoted sources to work with
func (c *Conductor) SeedDiscovery(entities []implicitmatcher.RegisteredEntity) {
	for _, e := range entities {
		// Add token and force promotion
		c.discoveryEngine.Registry.AddToken(e.Label)
		stats := c.discoveryEngine.Registry.GetStats(e.Label)
		if stats != nil {
			stats.Status = discovery.StatusPromoted
			// Parse Kind from interface{}
			var kind implicitmatcher.EntityKind
			switch v := e.Kind.(type) {
			case string:
				kind = implicitmatcher.ParseKind(v)
			case float64:
				kind = implicitmatcher.EntityKind(int(v))
			case implicitmatcher.EntityKind:
				kind = v
			default:
				kind = implicitmatcher.KindOther
			}
			stats.InferredKind = &kind
		}
	}
}
