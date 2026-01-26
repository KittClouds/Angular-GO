// Package dafsa provides a runtime dictionary using Aho-Corasick.
// Single AC automaton serves as both dictionary lookup AND text scanner.
package dafsa

import (
	"strings"
	"unicode"

	ahocorasick "github.com/petar-dambovaliev/aho-corasick"
)

// ============================================================================
// String Utilities (inline, no separate package)
// ============================================================================

// NormalizeRaw cleans and lowercases text for matching.
func NormalizeRaw(s string) string {
	var out strings.Builder
	out.Grow(len(s))

	for _, ch := range s {
		c := unicode.ToLower(ch)

		// Curly apostrophe -> straight
		if c == '\u2019' {
			out.WriteRune('\'')
			continue
		}

		if unicode.IsLetter(c) || unicode.IsDigit(c) || c == '\'' {
			out.WriteRune(c)
		} else if unicode.IsSpace(c) {
			out.WriteRune(' ')
		} else {
			out.WriteRune(' ')
		}
	}

	return strings.Join(strings.Fields(out.String()), " ")
}

// StopWords to filter in tokenization
var StopWords = map[string]bool{
	"mr": true, "mrs": true, "ms": true, "dr": true, "prof": true,
	"the": true, "of": true, "and": true, "a": true, "an": true,
	"to": true, "in": true, "on": true, "for": true, "at": true, "by": true,
	"is": true, "it": true, "as": true, "be": true, "was": true,
	"are": true, "been": true, "with": true, "from": true, "into": true,
	"that": true, "this": true, "has": true, "have": true, "had": true,
	"his": true, "her": true, "its": true, "their": true,
}

// TokenizeNorm splits and normalizes, filtering stop words.
func TokenizeNorm(text string) []string {
	normalized := NormalizeRaw(text)
	words := strings.Fields(normalized)

	result := make([]string, 0, len(words))
	for _, w := range words {
		if len(w) > 0 && !StopWords[w] {
			result = append(result, w)
		}
	}
	return result
}

// ============================================================================
// Entity Types
// ============================================================================

// EntityKind represents the type of entity
type EntityKind int

const (
	KindCharacter EntityKind = iota
	KindPlace
	KindFaction
	KindOrganization
	KindItem
	KindEvent
	KindConcept
	KindOther
)

// Priority returns the matching priority (higher = prefer)
func (k EntityKind) Priority() int {
	switch k {
	case KindCharacter:
		return 10
	case KindPlace:
		return 8
	case KindFaction, KindOrganization:
		return 7
	case KindItem:
		return 5
	case KindConcept:
		return 3
	case KindEvent:
		return 1
	default:
		return 2
	}
}

func (k EntityKind) String() string {
	names := []string{"CHARACTER", "PLACE", "FACTION", "ORGANIZATION", "ITEM", "EVENT", "CONCEPT", "OTHER"}
	if int(k) < len(names) {
		return names[k]
	}
	return "OTHER"
}

// ParseKind parses string to EntityKind
func ParseKind(s string) EntityKind {
	switch strings.ToUpper(s) {
	case "CHARACTER", "NPC":
		return KindCharacter
	case "PLACE", "LOCATION":
		return KindPlace
	case "FACTION":
		return KindFaction
	case "ORGANIZATION":
		return KindOrganization
	case "ITEM":
		return KindItem
	case "EVENT":
		return KindEvent
	case "CONCEPT":
		return KindConcept
	default:
		return KindOther
	}
}

// EntityInfo holds entity metadata
type EntityInfo struct {
	ID          string
	Label       string
	Kind        EntityKind
	NarrativeID string
}

// RegisteredEntity is input for dictionary compilation
type RegisteredEntity struct {
	ID          string
	Label       string
	Aliases     []string
	Kind        EntityKind
	NarrativeID string
}

// ============================================================================
// RuntimeDictionary - Dual-Purpose Aho-Corasick
// ============================================================================

// RuntimeDictionary uses AC for both dictionary lookup AND text scanning.
type RuntimeDictionary struct {
	// The AC automaton built from all surface forms
	ac ahocorasick.AhoCorasick

	// Pattern index -> Entity IDs (multiple entities may share pattern)
	patternToIDs [][]string

	// Normalized pattern -> pattern index
	patternIndex map[string]int

	// Entity ID -> EntityInfo
	idToInfo map[string]*EntityInfo

	// All patterns in order (for AC builder)
	patterns []string
}

// NewRuntimeDictionary creates an empty dictionary
func NewRuntimeDictionary() *RuntimeDictionary {
	return &RuntimeDictionary{
		patternToIDs: [][]string{},
		patternIndex: make(map[string]int),
		idToInfo:     make(map[string]*EntityInfo),
		patterns:     []string{},
	}
}

// Compile builds a RuntimeDictionary from registered entities
func Compile(entities []RegisteredEntity) (*RuntimeDictionary, error) {
	dict := NewRuntimeDictionary()

	for _, e := range entities {
		// Store entity info
		dict.idToInfo[e.ID] = &EntityInfo{
			ID:          e.ID,
			Label:       e.Label,
			Kind:        e.Kind,
			NarrativeID: e.NarrativeID,
		}

		// Collect all surface forms
		surfaces := []string{e.Label}
		surfaces = append(surfaces, e.Aliases...)
		surfaces = append(surfaces, generateAutoAliases(e.Label, e.Kind)...)

		for _, surface := range surfaces {
			key := NormalizeRaw(surface)
			if key == "" {
				continue
			}

			// Check if pattern already exists
			if idx, exists := dict.patternIndex[key]; exists {
				// Add entity ID to existing pattern
				dict.patternToIDs[idx] = appendUnique(dict.patternToIDs[idx], e.ID)
			} else {
				// New pattern
				idx := len(dict.patterns)
				dict.patterns = append(dict.patterns, key)
				dict.patternIndex[key] = idx
				dict.patternToIDs = append(dict.patternToIDs, []string{e.ID})
			}
		}
	}

	// Build AC automaton
	builder := ahocorasick.NewAhoCorasickBuilder(ahocorasick.Opts{
		AsciiCaseInsensitive: true,
		MatchOnlyWholeWords:  false,
		MatchKind:            ahocorasick.LeftMostLongestMatch,
	})
	dict.ac = builder.Build(dict.patterns)

	return dict, nil
}

// ============================================================================
// Dictionary Lookup (Use 1)
// ============================================================================

// Lookup finds entities matching a surface form (exact dictionary lookup)
func (d *RuntimeDictionary) Lookup(surface string) []*EntityInfo {
	key := NormalizeRaw(surface)
	idx, exists := d.patternIndex[key]
	if !exists {
		return nil
	}

	ids := d.patternToIDs[idx]
	result := make([]*EntityInfo, 0, len(ids))
	for _, id := range ids {
		if info, ok := d.idToInfo[id]; ok {
			result = append(result, info)
		}
	}
	return result
}

// IsKnownEntity checks if a token matches any known entity
func (d *RuntimeDictionary) IsKnownEntity(token string) bool {
	key := NormalizeRaw(token)
	_, exists := d.patternIndex[key]
	return exists
}

// GetInfo retrieves entity info by ID
func (d *RuntimeDictionary) GetInfo(id string) *EntityInfo {
	return d.idToInfo[id]
}

// ============================================================================
// Text Scanning (Use 2)
// ============================================================================

// Match represents a detected entity in text
type Match struct {
	Start       int    // Byte offset start
	End         int    // Byte offset end
	MatchedText string // Original text slice
	PatternIdx  int    // Index into patterns slice
}

// Scan finds all entity mentions in text (O(n) via AC)
func (d *RuntimeDictionary) Scan(text string) []Match {
	// Normalize for matching, but track byte mapping
	normalized := strings.ToLower(text)

	matches := d.ac.FindAll(normalized)
	result := make([]Match, 0, len(matches))

	for _, m := range matches {
		result = append(result, Match{
			Start:       m.Start(),
			End:         m.End(),
			MatchedText: text[m.Start():m.End()],
			PatternIdx:  m.Pattern(),
		})
	}

	return result
}

// ScanWithInfo returns matches with resolved entity info
func (d *RuntimeDictionary) ScanWithInfo(text string) []struct {
	Match
	Entities []*EntityInfo
} {
	matches := d.Scan(text)
	result := make([]struct {
		Match
		Entities []*EntityInfo
	}, 0, len(matches))

	for _, m := range matches {
		ids := d.patternToIDs[m.PatternIdx]
		entities := make([]*EntityInfo, 0, len(ids))
		for _, id := range ids {
			if info := d.idToInfo[id]; info != nil {
				entities = append(entities, info)
			}
		}

		result = append(result, struct {
			Match
			Entities []*EntityInfo
		}{m, entities})
	}

	return result
}

// SelectBest picks highest-priority entity from matches
func (d *RuntimeDictionary) SelectBest(ids []string) *EntityInfo {
	var best *EntityInfo
	for _, id := range ids {
		info := d.idToInfo[id]
		if info == nil {
			continue
		}
		if best == nil || info.Kind.Priority() > best.Kind.Priority() {
			best = info
		}
	}
	return best
}

// ============================================================================
// Auto-Alias Generation
// ============================================================================

func generateAutoAliases(label string, kind EntityKind) []string {
	tokens := TokenizeNorm(label)
	if len(tokens) <= 1 {
		return nil
	}

	first := tokens[0]
	last := tokens[len(tokens)-1]
	var out []string

	if kind == KindCharacter {
		if len(last) >= 3 {
			out = append(out, last)
		}
		if len(tokens) >= 3 && first != last {
			out = append(out, first+" "+last)
		}
		if len(first) >= 4 && first != last {
			out = append(out, first)
		}
	}

	if kind == KindFaction || kind == KindOrganization {
		var acronym strings.Builder
		for _, tok := range tokens {
			if len(tok) > 0 {
				acronym.WriteByte(tok[0])
			}
		}
		if acronym.Len() >= 2 && acronym.Len() <= 5 {
			out = append(out, acronym.String())
		}

		suffixes := []string{"pirates", "pirate", "crew", "gang", "guild", "army"}
		for _, suffix := range suffixes {
			if last == suffix && len(tokens) >= 2 {
				partial := strings.Join(tokens[:len(tokens)-1], " ")
				out = append(out, partial)
				break
			}
		}
	}

	if kind == KindPlace && len(first) >= 4 {
		out = append(out, first)
	}

	return out
}

func appendUnique(slice []string, item string) []string {
	for _, s := range slice {
		if s == item {
			return slice
		}
	}
	return append(slice, item)
}
