package graptor

import (
	"regexp"
	"strings"
)

// AliasPattern represents a pattern for detecting aliases.
type AliasPattern struct {
	Pattern     *regexp.Regexp
	Template    string
	GroupNames  []string // Names of capture groups
	Description string
}

// AliasDetector detects alias relationships between entities.
// Patterns like "X, also known as Y" or "X, aka Y" or "X (Y)" etc.
type AliasDetector struct {
	patterns []*AliasPattern
}

// NewAliasDetector creates a new alias detector with default patterns.
func NewAliasDetector() *AliasDetector {
	return &AliasDetector{
		patterns: []*AliasPattern{
			// "Ryan Romano, also known as Quicksave"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*,\s*also\s+known\s+as\s+(\w+(?:\s+\w+)?)`),
				Template:    "$1, also known as $2",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X, also known as Y",
			},
			// "Ryan Romano, aka Quicksave"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*,\s*aka\s+(\w+(?:\s+\w+)?)`),
				Template:    "$1, aka $2",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X, aka Y",
			},
			// "Ryan Romano (Quicksave)"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*\((\w+(?:\s+\w+)?)\)`),
				Template:    "$1 ($2)",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X (Y) - parenthetical alias",
			},
			// "Ryan Romano or Quicksave"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s+or\s+(\w+(?:\s+\w+)?)`),
				Template:    "$1 or $2",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X or Y",
			},
			// "Quicksave, real name Ryan Romano"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*,\s*real\s+name\s+(\w+(?:\s+\w+)?)`),
				Template:    "$1, real name $2",
				GroupNames:  []string{"alias", "realname"},
				Description: "X, real name Y",
			},
			// "Ryan Romano, otherwise known as Quicksave"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*,\s*otherwise\s+known\s+as\s+(\w+(?:\s+\w+)?)`),
				Template:    "$1, otherwise known as $2",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X, otherwise known as Y",
			},
			// "Quicksave - Ryan Romano"
			{
				Pattern:     regexp.MustCompile(`(?i)(\w+(?:\s+\w+)?)\s*-\s*(\w+(?:\s+\w+)?)`),
				Template:    "$1 - $2",
				GroupNames:  []string{"entity1", "entity2"},
				Description: "X - Y (dash separated)",
			},
		},
	}
}

// DetectedAlias represents a detected alias relationship.
type DetectedAlias struct {
	Entity1     string
	Entity2     string
	Pattern     string
	Confidence  float64
	IsNewAlias  bool   // True if one entity is new
	KnownEntity string // ID of the known entity if IsNewAlias
}

// DetectAliases scans text for alias patterns and returns detected alias pairs.
func (ad *AliasDetector) DetectAliases(text string) []DetectedAlias {
	var results []DetectedAlias

	for _, pattern := range ad.patterns {
		matches := pattern.Pattern.FindAllStringSubmatch(text, -1)
		for _, match := range matches {
			if len(match) >= 3 {
				entity1 := cleanEntityName(match[1])
				entity2 := cleanEntityName(match[2])

				if entity1 != "" && entity2 != "" && entity1 != entity2 {
					results = append(results, DetectedAlias{
						Entity1:    entity1,
						Entity2:    entity2,
						Pattern:    pattern.Description,
						Confidence: 0.9,
					})
				}
			}
		}
	}

	return results
}

// DetectAliasesInContext detects aliases when entities are already known.
// This version checks if detected aliases match known entities in the registry.
func (ad *AliasDetector) DetectAliasesInContext(text string, registry *GlobalEntityRegistry) []DetectedAlias {
	candidates := ad.DetectAliases(text)
	var confirmed []DetectedAlias

	for _, candidate := range candidates {
		// Check if either entity is already known
		e1 := registry.Lookup(candidate.Entity1)
		e2 := registry.Lookup(candidate.Entity2)

		if e1 != nil && e2 != nil {
			// Both entities exist - this is a cross-reference confirmation
			confirmed = append(confirmed, candidate)
		} else if e1 != nil {
			// Entity1 exists, Entity2 is an alias
			confirmed = append(confirmed, DetectedAlias{
				Entity1:     candidate.Entity1,
				Entity2:     candidate.Entity2,
				Pattern:     candidate.Pattern,
				Confidence:  0.95,
				IsNewAlias:  true,
				KnownEntity: e1.ID,
			})
		} else if e2 != nil {
			// Entity2 exists, Entity1 is an alias
			confirmed = append(confirmed, DetectedAlias{
				Entity1:     candidate.Entity1,
				Entity2:     candidate.Entity2,
				Pattern:     candidate.Pattern,
				Confidence:  0.95,
				IsNewAlias:  true,
				KnownEntity: e2.ID,
			})
		}
	}

	return confirmed
}

// cleanEntityName cleans up an entity name extracted from text.
func cleanEntityName(name string) string {
	// Remove leading/trailing whitespace
	name = strings.TrimSpace(name)
	// Remove common articles
	name = strings.TrimPrefix(name, "the ")
	name = strings.TrimPrefix(name, "The ")
	return name
}

// AddPattern adds a custom alias detection pattern.
func (ad *AliasDetector) AddPattern(pattern string, template string, groupNames []string, description string) error {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return err
	}

	ad.patterns = append(ad.patterns, &AliasPattern{
		Pattern:     re,
		Template:    template,
		GroupNames:  groupNames,
		Description: description,
	})

	return nil
}
