// Package resolver implements coreference resolution (pronouns and aliases).
// It maintains a narrative context to track recency and gender.
package resolver

import (
	"strings"
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
	ID      string
	Name    string
	Gender  Gender
	Aliases []string
	Kind    string
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
}

// New creating a new Resolver
func New() *Resolver {
	return &Resolver{
		Context: NewContext(),
	}
}

// Resolve attempts to resolve text (pronoun or alias) to an EntityID
func (r *Resolver) Resolve(text string) string {
	if r.isPronoun(text) {
		gender := r.inferPronounGender(text)
		return r.Context.FindMostRecent(gender)
	}

	// Check direct alias match
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
