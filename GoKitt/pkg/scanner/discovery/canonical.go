package discovery

import (
	"strings"
	"unicode"
)

// CanonicalToken represents a normalized string key for deduplication
type CanonicalToken string

// Canonicalize processes a raw token into a canonical key and a display form.
// Returns (key, display, valid).
// Heuristics:
// 1. Trim punctuation (except internal ' and -)
// 2. Remove possessive 's
// 3. Reject junk (no letters, single letter non-alpha)
func Canonicalize(raw string) (CanonicalToken, string, bool) {
	// 1. Trim edge punctuation
	trimmed := strings.TrimFunc(raw, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '\'' && r != '-'
	})

	if trimmed == "" {
		return "", "", false
	}

	// 2. Normalize apostrophes (curly to straight)
	cleaned := strings.ReplaceAll(trimmed, "’", "'")

	// 3. Strip possessive 's
	if len(cleaned) > 2 && strings.HasSuffix(strings.ToLower(cleaned), "'s") {
		cleaned = cleaned[:len(cleaned)-2]
	}

	// 4. Reject if no letters
	hasAlpha := false
	for _, r := range cleaned {
		if unicode.IsLetter(r) {
			hasAlpha = true
			break
		}
	}
	if !hasAlpha || len(cleaned) < 2 {
		// Exception: "A", "I" are valid words but rarely proper nouns in isolation for discovery unless context helps.
		// For now, reject < 2 unless it's a specific allowlist (which we don't have yet).
		return "", "", false
	}

	// Key is lowercase
	key := strings.ToLower(cleaned)

	return CanonicalToken(key), cleaned, true
}
