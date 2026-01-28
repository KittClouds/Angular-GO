// Package resolver implements coreference resolution (pronouns and aliases).
// It maintains a narrative context to track recency and gender.
package resolver

import (
	"strings"

	"github.com/kittclouds/gokitt/pkg/resorank"
)

// Gender of an entity
type Gender int

const (
	GenderUnknown Gender = iota
	GenderMale
	GenderFemale
	GenderNeutral
	GenderPlural
)

// EntityMetadata represents a known entity in the context
type EntityMetadata struct {
	ID        string
	Name      string
	Gender    Gender
	Aliases   []string
	Kind      string
	Embedding []float32
}

// NarrativeContext tracks the state of the narrative
type NarrativeContext struct {
	history    []string // Stack of entity IDs (most recent at front)
	registry   map[string]EntityMetadata
	maxHistory int

	// Contextual fields
	ScenarioID       string
	ActiveCharacters []string
	Speaker          string
	InDialogue       bool
}

// NewContext creates a new narrative context
func NewContext() *NarrativeContext {
	return &NarrativeContext{
		history:    make([]string, 0),
		registry:   make(map[string]EntityMetadata),
		maxHistory: 10,
	}
}

// Register adds an entity to the known registry
func (nc *NarrativeContext) Register(e EntityMetadata) {
	nc.registry[e.ID] = e
}

// PushMention records a mention, moving it to the front of history
func (nc *NarrativeContext) PushMention(entityID string) {
	// Remove existing occurrence
	for i, id := range nc.history {
		if id == entityID {
			// Remove element at i
			nc.history = append(nc.history[:i], nc.history[i+1:]...)
			break
		}
	}

	// Push to front
	nc.history = append([]string{entityID}, nc.history...)

	// Trim if too long
	if len(nc.history) > nc.maxHistory {
		nc.history = nc.history[:nc.maxHistory]
	}
}

// FindMostRecent finds the most recent entity matching the gender
func (nc *NarrativeContext) FindMostRecent(gender Gender) string {
	for _, id := range nc.history {
		if meta, ok := nc.registry[id]; ok {
			if gendersCompatible(meta.Gender, gender) {
				return id
			}
		}
	}
	return ""
}

func gendersCompatible(entityGender, pronounGender Gender) bool {
	if entityGender == pronounGender {
		return true
	}
	if pronounGender == GenderUnknown {
		return true // Unknown pronoun matches anything
	}
	if entityGender == GenderUnknown {
		return true // Unknown entity matches any pronoun
	}
	// "They" can refer to singular neutral/unknown in some contexts, but strict for now
	if pronounGender == GenderPlural {
		// Could match Plural entities or Neutral/Unknown
		return entityGender == GenderPlural || entityGender == GenderNeutral
	}
	return false
}

// Resolver handles pronoun and alias resolution
type Resolver struct {
	Context *NarrativeContext
	Scorer  *resorank.Scorer
}

// New creating a new Resolver
func New() *Resolver {
	cfg := resorank.DefaultConfig()
	// Tune for alias matching
	cfg.VectorAlpha = 0.5           // 50/50 mix
	cfg.FieldWeights["name"] = 10.0 // Exact name match is high
	cfg.FieldWeights["alias"] = 5.0 // Alias match is good
	cfg.FieldWeights["kind"] = 1.0  // Weak signal
	cfg.B = 0.5                     // Short text, lower length normalization penalty

	return &Resolver{
		Context: NewContext(),
		Scorer:  resorank.NewScorer(cfg),
	}
}

// RegisterEntity registers an entity with both the context and the fuzzy scorer
func (r *Resolver) RegisterEntity(e EntityMetadata) {
	r.Context.Register(e)

	// Index into ResoRank
	meta := resorank.DocumentMetadata{
		TotalTokenCount: 1 + len(e.Aliases), // heuristic
		FieldLengths: map[string]int{
			"name":  len(strings.Split(e.Name, " ")),
			"alias": len(e.Aliases), // treats aliases as one bag for length? approximation
			"kind":  1,
		},
		Embedding: e.Embedding,
	}

	tokens := make(map[string]resorank.TokenMetadata)

	// Index Name
	for _, word := range strings.Fields(strings.ToLower(e.Name)) {
		tokens[word] = resorank.TokenMetadata{
			CorpusDocFreq: 1,
			FieldOccurrences: map[string]resorank.FieldOccurrence{
				"name": {TF: 1, FieldLength: meta.FieldLengths["name"]},
			},
		}
	}

	// Index Aliases
	for _, alias := range e.Aliases {
		for _, word := range strings.Fields(strings.ToLower(alias)) {
			// Merge if exists
			if tm, ok := tokens[word]; ok {
				if fo, ok := tm.FieldOccurrences["alias"]; ok {
					fo.TF++
					tm.FieldOccurrences["alias"] = fo
				} else {
					tm.FieldOccurrences["alias"] = resorank.FieldOccurrence{TF: 1, FieldLength: 10} // approx
				}
				tokens[word] = tm
			} else {
				tokens[word] = resorank.TokenMetadata{
					CorpusDocFreq: 1,
					FieldOccurrences: map[string]resorank.FieldOccurrence{
						"alias": {TF: 1, FieldLength: 10},
					},
				}
			}
		}
	}

	r.Scorer.IndexDocument(e.ID, meta, tokens)
}

// Resolve attempts to resolve text (pronoun or alias) to an EntityID
func (r *Resolver) Resolve(text string, queryVector []float32) string {
	if r.isPronoun(text) {
		gender := r.inferPronounGender(text)
		return r.Context.FindMostRecent(gender)
	}

	// 1. Direct Alias Match (Fastest)
	lower := strings.ToLower(text)
	for _, meta := range r.Context.registry {
		if strings.ToLower(meta.Name) == lower {
			return meta.ID
		}
		for _, alias := range meta.Aliases {
			if strings.ToLower(alias) == lower {
				return meta.ID
			}
		}
	}

	// 2. Fuzzy/Hybrid Match (ResoRank)
	// Split query
	queryTokens := strings.Fields(lower)

	results := r.Scorer.Search(queryTokens, queryVector, 1)
	if len(results) > 0 {
		// Threshold check?
		// For now if scoring > 0.5 (arbitrary), take it
		if results[0].Score > 1.0 { // BM25 scores can be high.
			return results[0].DocID
		}
	}

	return ""
}

// ObserveMention updates context with an explicit mention
func (r *Resolver) ObserveMention(entityID string) {
	r.Context.PushMention(entityID)
}

func (r *Resolver) isPronoun(text string) bool {
	switch strings.ToLower(text) {
	case "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them", "their":
		return true
	default:
		return false
	}
}

func (r *Resolver) inferPronounGender(text string) Gender {
	switch strings.ToLower(text) {
	case "he", "him", "his":
		return GenderMale
	case "she", "her", "hers":
		return GenderFemale
	case "it", "its":
		return GenderNeutral
	case "they", "them", "their":
		return GenderPlural
	default:
		return GenderUnknown
	}
}
