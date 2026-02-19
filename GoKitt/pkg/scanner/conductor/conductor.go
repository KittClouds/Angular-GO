package conductor

import (
	"fmt"
	"sort"
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

// Scan processes text through all pipeline stages (NER-Native Architecture)
func (c *Conductor) Scan(text string) ScanResult {
	// -------------------------------------------------------------------------
	// PHASE 1: NER (Discovery + Implicit) - The Authority
	// -------------------------------------------------------------------------

	// Collect all valid entity spans to build the mask
	var entitySpans []struct {
		Start int
		End   int
		Kind  string
		ID    string
		Text  string
		Match syntax.SyntaxMatch // Keep original match for final output
	}

	// 1a. Run Discovery "Virus" (Unsupervised NER)
	discoveryCandidates := c.discoveryEngine.ScanText(text)
	for _, cand := range discoveryCandidates {
		kindStr := "Unknown"
		if cand.Kind != nil {
			kindStr = cand.Kind.String()
		}
		// Register with resolver so pronouns work
		c.resolver.ObserveMention(cand.Text)

		// Create SyntaxMatch for output
		sm := syntax.SyntaxMatch{
			Start:      cand.Start,
			End:        cand.End,
			Text:       cand.Text,
			ID:         cand.Text, // speculative ID
			Original:   cand.Text,
			Kind:       syntax.KindEntity,
			EntityKind: kindStr,
			Label:      cand.Text,
		}

		entitySpans = append(entitySpans, struct {
			Start int
			End   int
			Kind  string
			ID    string
			Text  string
			Match syntax.SyntaxMatch
		}{
			Start: cand.Start,
			End:   cand.End,
			Kind:  kindStr,
			ID:    cand.Text,
			Text:  cand.Text,
			Match: sm,
		})
	}

	// 1b. Implicit Matcher Pass (Registry Entities)
	if c.implicitScanner != nil {
		implicitHits := c.implicitScanner.ScanWithInfo(text)
		for _, hit := range implicitHits {
			// STOPWORD FILTER: Even if in dictionary, filter if it's a stopword (e.g. "The", "But")
			if c.discoveryEngine.Registry.IsIgnored(hit.MatchedText) {
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
				// Also register with resolver
				c.resolver.ObserveMention(bestEntity.Label)

				sm := syntax.SyntaxMatch{
					Start:      hit.Start,
					End:        hit.End,
					Text:       hit.MatchedText,
					ID:         bestEntity.ID,
					Original:   hit.MatchedText,
					Kind:       syntax.KindEntity,
					EntityKind: bestEntity.Kind.String(),
					Label:      bestEntity.Label,
				}

				entitySpans = append(entitySpans, struct {
					Start int
					End   int
					Kind  string
					ID    string
					Text  string
					Match syntax.SyntaxMatch
				}{
					Start: hit.Start,
					End:   hit.End,
					Kind:  bestEntity.Kind.String(),
					ID:    bestEntity.ID,
					Text:  hit.MatchedText,
					Match: sm,
				})
			}
		}
	}

	// -------------------------------------------------------------------------
	// PHASE 2: MASKING
	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------
	// PHASE 2: SORT & MASK
	// -------------------------------------------------------------------------

	// Sort spans by position to ensure:
	// 1. Mask is built in order (required for optimal binary search construction, though Add handles sort)
	sort.Slice(entitySpans, func(i, j int) bool {
		return entitySpans[i].Start < entitySpans[j].Start
	})

	mask := chunker.NewIntervalMask()

	for _, span := range entitySpans {
		// Do NOT observe here. We observe during token iteration to interleave with pronouns.
		// Add to mask
		mask.Add(span.Start, span.End, span.Kind, span.ID)
	}

	// -------------------------------------------------------------------------
	// PHASE 3: MASKED CHUNKING (Structure respecting Entities)
	// -------------------------------------------------------------------------

	chunkResult := c.chunker.Chunk(text, mask)

	// -------------------------------------------------------------------------
	// PHASE 4: NARRATIVE (Events)
	// -------------------------------------------------------------------------
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

	// -------------------------------------------------------------------------
	// PHASE 5: RESOLVER (Pronouns & Entities Interlaced)
	// -------------------------------------------------------------------------
	var resolvedRefs []ResolvedReference

	for _, token := range chunkResult.Tokens {
		// 1. Is this token a masked entity?
		if iv := mask.GetInterval(token.Range.Start); iv != nil {
			// YES: It's a known entity (e.g. "Gandalf" or "Nuclear Bomb")
			// We must Observe it NOW so it enters the history for subsequent pronouns.
			// Note: Multi-word entities (Nuclear Bomb) are single tokens in chunkResult,
			// so this works perfectly.
			c.resolver.ObserveMention(iv.ID)
			continue
		}

		// 2. Is this token a Pronoun?
		if token.POS == chunker.Pronoun {
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

	// -------------------------------------------------------------------------
	// OUTPUT ASSEMBLY
	// -------------------------------------------------------------------------

	// Collect "Final Matches" from the Authoritative Entity Spans
	// Explicit/Legacy syntax is REMOVED from this flow, as per NER-Native plan.
	finalMatches := make([]syntax.SyntaxMatch, 0, len(entitySpans))
	for _, span := range entitySpans {
		finalMatches = append(finalMatches, span.Match)
	}

	fmt.Printf("[Conductor] NER-Native Scan: %d Entities, %d Chunks\n", len(finalMatches), len(chunkResult.Chunks))

	return ScanResult{
		Text:         text,
		CleanText:    text,
		Syntax:       finalMatches, // Now purely NER-driven
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
