// Package conductor orchestrates the entire scanning pipeline.
// It wires together Syntax, Implicit, Chunker, Narrative, Resolver, and Discovery.
package conductor

import (
	"strings"

	"github.com/kittclouds/gokitt/pkg/dafsa"
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
	implicitScanner  *dafsa.RuntimeDictionary
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
func (c *Conductor) SetDictionary(dict *dafsa.RuntimeDictionary) {
	c.implicitScanner = dict
}

// Scan processes text through all pipeline stages
func (c *Conductor) Scan(text string) ScanResult {
	// 1. Syntax Pass (Explicit Tags/Links)
	synMatches := c.syntaxScanner.Scan(text)
	c.registerExplicitEntities(synMatches)

	// 2. Chunker Pass (Structure)
	chunkResult := c.chunker.Chunk(text)

	// 3. Harvest Candidates (All NPs)
	for _, chunk := range chunkResult.Chunks {
		if chunk.Kind == chunker.NounPhrase {
			head := chunk.HeadText(text)
			c.discoveryEngine.ObserveToken(head)
		}
	}

	// 4. Narrative Pass (Verbs -> Events) & Discovery "Virus"
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
					if subjKind != dafsa.KindOther {
						c.discoveryEngine.ObserveRelation(subjKind, match, objText)
					}
				}

				// Resolve Entity IDs for final output
				subjID := c.resolver.Resolve(subjText)
				if subjID == "" {
					subjID = subjText
				}

				objID := c.resolver.Resolve(objText)
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

	// 5. Resolver Pass (Pronouns) - Second pass for remaining tokens
	var resolvedRefs []ResolvedReference
	for _, token := range chunkResult.Tokens {
		if token.POS == chunker.Pronoun || token.POS == chunker.ProperNoun {
			word := token.Text
			if id := c.resolver.Resolve(word); id != "" {
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

			c.resolver.Context.Register(resolver.EntityMetadata{
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
			kind := dafsa.ParseKind(m.EntityKind)
			c.discoveryEngine.Registry.ProposeInference(m.Label, kind)
		}
	}
}

func (c *Conductor) resolveKind(text string) dafsa.EntityKind {
	// 1. Check Resolver/Explicit
	// (Resolver tracks EntityMetadata but not DAFSA Kind directly, needs alignment)
	// For now, assume Character if Proper Noun and unknown

	// 2. Check Discovery Registry
	stats := c.discoveryEngine.Registry.GetStats(text)
	if stats != nil && stats.InferredKind != nil {
		return *stats.InferredKind
	}

	return dafsa.KindCharacter // Aggressive default for demo
}

// GetMatcher returns the narrative matcher for external use (Projection)
func (c *Conductor) GetMatcher() *narrative.NarrativeMatcher {
	return c.narrativeMatcher
}
