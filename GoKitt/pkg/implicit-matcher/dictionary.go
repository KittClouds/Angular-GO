// Package dafsa provides a runtime dictionary using Aho-Corasick.
// Single AC automaton serves as both dictionary lookup AND text scanner.
package implicitmatcher

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/coregx/ahocorasick"
)

// ============================================================================
// UNIFIED CANONICALIZER - Used for BOTH pattern compilation AND document scanning
// ============================================================================

// isJoiner returns true for punctuation that commonly appears INSIDE names/terms.
// These are preserved during canonicalization to keep multiword entities coherent.
// Examples: "Monkey D. Luffy", "O'Brien", "Jean-Luc", "AT&T"
func isJoiner(r rune) bool {
	switch r {
	case '\'', '\u2019', '\u2018', // apostrophe, curly apostrophe variants
		'-', '\u2013', '\u2014', // hyphen, en-dash, em-dash
		'\u00B7', '.', '_', '/', '#', '&': // middle dot, period, underscore, etc.
		return true
	default:
		return false
	}
}

// isSeparator returns true for characters that split tokens.
// Everything that's not a letter, digit, or joiner is a separator.
func isSeparator(r rune) bool {
	if unicode.IsLetter(r) || unicode.IsDigit(r) || isJoiner(r) {
		return false
	}
	return true
}

// CanonicalizeForMatch transforms text into a normalized form for Aho-Corasick matching.
// This is THE function used by both pattern compilation and document scanning.
// Rules:
// - Fold to lowercase
// - Preserve letters, digits, and joiners (apostrophe, hyphen, period, etc.)
// - Replace all other characters with a single space
// - Collapse multiple spaces into one
// - Trim leading/trailing spaces
//
// This allows multiword patterns like "Monkey D. Luffy" to match correctly.
func CanonicalizeForMatch(s string) string {
	var out strings.Builder
	out.Grow(len(s))

	lastWasSpace := true // Start true to trim leading spaces

	for _, ch := range s {
		c := unicode.ToLower(ch)

		// Normalize curly apostrophe to straight
		if c == '\u2019' || c == '\u2018' {
			c = '\''
		}
		// Normalize en-dash/em-dash to hyphen
		if c == '\u2013' || c == '\u2014' {
			c = '-'
		}

		if unicode.IsLetter(c) || unicode.IsDigit(c) || isJoiner(c) {
			out.WriteRune(c)
			lastWasSpace = false
		} else {
			// Replace any separator with a single space (collapse runs)
			if !lastWasSpace {
				out.WriteRune(' ')
				lastWasSpace = true
			}
		}
	}

	result := out.String()
	// Trim trailing space
	if len(result) > 0 && result[len(result)-1] == ' ' {
		result = result[:len(result)-1]
	}
	return result
}

// NormalizeRaw is kept for backward compatibility - calls CanonicalizeForMatch
func NormalizeRaw(s string) string {
	return CanonicalizeForMatch(s)
}

// ============================================================================
// TOKEN WITH OFFSETS - For span anchoring in the UI
// ============================================================================

// Tok represents a token with its position in the original text.
type Tok struct {
	Text  string // The token text (canonicalized)
	Start int    // Byte offset in original string
	End   int    // Byte offset (exclusive)
}

// TokenizeWithOffsets splits text into tokens while preserving byte offsets.
// Useful for NER candidate generation where you need to anchor spans.
func TokenizeWithOffsets(s string) []Tok {
	out := make([]Tok, 0, 64)

	i := 0
	for i < len(s) {
		// Skip separators
		for i < len(s) {
			r, w := utf8.DecodeRuneInString(s[i:])
			if !isSeparator(r) {
				break
			}
			i += w
		}
		start := i

		// Consume token characters
		for i < len(s) {
			r, w := utf8.DecodeRuneInString(s[i:])
			if isSeparator(r) {
				break
			}
			i += w
		}
		end := i

		if start < end {
			// Canonicalize the token text (lowercase, normalize apostrophes)
			tokenText := CanonicalizeForMatch(s[start:end])
			out = append(out, Tok{Text: tokenText, Start: start, End: end})
		}
	}

	return out
}

// ============================================================================
// StopWords - for filtering common words in NER
// ============================================================================

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
	normalized := CanonicalizeForMatch(text)
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

// UnmarshalJSON allows EntityKind to be deserialized from string values
func (k *EntityKind) UnmarshalJSON(data []byte) error {
	// Remove quotes from JSON string
	s := strings.Trim(string(data), `"`)
	*k = ParseKind(s)
	return nil
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
	Kind        interface{} // Handle string, int, or object
	NarrativeID string
}

// ============================================================================
// RuntimeDictionary - Dual-Purpose Aho-Corasick
// ============================================================================

// RuntimeDictionary uses AC for both dictionary lookup AND text scanning.
type RuntimeDictionary struct {
	// The AC automaton built from all surface forms
	ac *ahocorasick.Automaton

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
		ac:           nil,
	}
}

// Compile builds a RuntimeDictionary from registered entities.
// Uses CanonicalizeForMatch for pattern normalization.
func Compile(entities []RegisteredEntity) (*RuntimeDictionary, error) {
	dict := NewRuntimeDictionary()

	for _, e := range entities {
		// Parse Kind dynamically
		var k EntityKind
		switch v := e.Kind.(type) {
		case EntityKind:
			k = v
		case int:
			k = EntityKind(v)
		case string:
			k = ParseKind(v)
		case float64:
			k = EntityKind(int(v))
		case map[string]interface{}:
			if t, ok := v["type"].(string); ok {
				k = ParseKind(t)
			} else {
				k = KindOther
			}
		default:
			k = KindOther
		}

		// Store entity info
		dict.idToInfo[e.ID] = &EntityInfo{
			ID:          e.ID,
			Label:       e.Label,
			Kind:        k,
			NarrativeID: e.NarrativeID,
		}

		// Collect all surface forms
		surfaces := []string{e.Label}
		surfaces = append(surfaces, e.Aliases...)
		surfaces = append(surfaces, generateAutoAliases(e.Label, k)...)

		for _, surface := range surfaces {
			// USE THE SHARED CANONICALIZER - critical for matching consistency
			key := CanonicalizeForMatch(surface)
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
	// Use LeftmostLongest for standard entity extraction behavior (prefer "San Francisco" over "San")
	automaton, err := ahocorasick.NewBuilder().
		AddStrings(dict.patterns).
		SetMatchKind(ahocorasick.LeftmostLongest).
		SetPrefilter(true).
		Build()

	if err != nil {
		return nil, err
	}
	dict.ac = automaton

	return dict, nil
}

// ============================================================================
// Dictionary Lookup (Use 1)
// ============================================================================

// Lookup finds entities matching a surface form (exact dictionary lookup)
func (d *RuntimeDictionary) Lookup(surface string) []*EntityInfo {
	if d.ac == nil {
		return nil
	}

	key := CanonicalizeForMatch(surface)
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
	key := CanonicalizeForMatch(token)
	_, exists := d.patternIndex[key]
	return exists
}

// GetInfo retrieves entity info by ID
func (d *RuntimeDictionary) GetInfo(id string) *EntityInfo {
	return d.idToInfo[id]
}

// GetAllEntities returns all entity info in the dictionary.
func (d *RuntimeDictionary) GetAllEntities() []*EntityInfo {
	entities := make([]*EntityInfo, 0, len(d.idToInfo))
	for _, info := range d.idToInfo {
		entities = append(entities, info)
	}
	return entities
}

// ============================================================================
// Text Scanning (Use 2)
// ============================================================================

// Match represents a detected entity in text
type Match struct {
	Start       int    // Byte offset start in ORIGINAL text
	End         int    // Byte offset end in ORIGINAL text
	MatchedText string // Original text slice (preserves casing)
	PatternIdx  int    // Index into patterns slice
}

// Scan finds all entity mentions in text (O(n) via AC).
// Uses CanonicalizeForMatch on input - THE SAME canonicalizer used for patterns.
// Returns offsets mapped back to the original text for accurate highlighting.
func (d *RuntimeDictionary) Scan(text string) []Match {
	if d.ac == nil {
		return nil
	}

	// Canonicalize the input text THE SAME WAY we canonicalized patterns
	canonicalized := CanonicalizeForMatch(text)
	haystack := []byte(canonicalized)

	// Build a mapping from canonicalized byte positions to original byte positions
	// This handles cases where canonicalization changes string length
	canonToOrig := buildOffsetMap(text)

	// Use FindAllOverlapping to find ALL entity mentions
	// For entity extraction we want every match; overlap handling is done at higher level
	matches := d.ac.FindAllOverlapping(haystack)
	result := make([]Match, 0, len(matches))

	for _, m := range matches {
		// Map canonicalized offsets back to original text
		origStart := mapOffset(m.Start, canonToOrig, len(text))
		origEnd := mapOffset(m.End, canonToOrig, len(text))

		// Validate bounds
		if origStart >= len(text) || origEnd > len(text) || origStart >= origEnd {
			continue
		}

		result = append(result, Match{
			Start:       origStart,
			End:         origEnd,
			MatchedText: text[origStart:origEnd],
			PatternIdx:  m.PatternID,
		})
	}

	return result
}

// buildOffsetMap creates a mapping from canonicalized byte positions to original positions.
// This allows us to map matches found in canonicalized text back to the original.
func buildOffsetMap(original string) []int {
	// For each byte position in the canonicalized string, store the corresponding
	// position in the original string
	mapping := make([]int, 0, len(original)+1)

	lastWasSpace := true
	origPos := 0

	for _, ch := range original {
		runeLen := utf8.RuneLen(ch)
		c := unicode.ToLower(ch)

		// Normalize curly apostrophe
		if c == '\u2019' || c == '\u2018' {
			c = '\''
		}
		// Normalize dashes
		if c == '\u2013' || c == '\u2014' {
			c = '-'
		}

		if unicode.IsLetter(c) || unicode.IsDigit(c) || isJoiner(c) {
			// This character appears in canonicalized output
			canonLen := utf8.RuneLen(c)
			for i := 0; i < canonLen; i++ {
				mapping = append(mapping, origPos)
			}
			lastWasSpace = false
		} else {
			// Separator - may become a single space
			if !lastWasSpace {
				mapping = append(mapping, origPos)
				lastWasSpace = true
			}
		}

		origPos += runeLen
	}

	// Add final position for end-of-string
	mapping = append(mapping, origPos)

	return mapping
}

// mapOffset converts a canonicalized byte offset to an original byte offset
func mapOffset(canonOffset int, mapping []int, originalLen int) int {
	if canonOffset >= len(mapping) {
		return originalLen
	}
	if canonOffset < 0 {
		return 0
	}
	return mapping[canonOffset]
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
