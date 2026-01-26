package chunker

import (
	"strings"
	"unicode"
)

// Tagger performs Part-of-Speech tagging with context awareness (Dynamic Reinforcement)
type Tagger struct {
	lexicon map[string]POS
}

// NewTagger creates a new Tagger with default lexicon
func NewTagger() *Tagger {
	t := &Tagger{
		lexicon: make(map[string]POS),
	}
	t.loadDefaultLexicon()
	return t
}

// Tag processes a slice of words and returns their POS tags
// Uses a 2-pass approach:
// 1. Baseline: Dictionary lookup + Suffix Heuristics
// 2. Reinforcement: Contextual correction rules
func (t *Tagger) Tag(words []string) []POS {
	tags := make([]POS, len(words))

	// Pass 1: Baseline (Static)
	for i, word := range words {
		tags[i] = t.lookupBaseline(word)
	}

	// Pass 2: Context Reinforcement (Dynamic)
	for i := 0; i < len(tags); i++ {
		currentWord := words[i]
		currentTag := tags[i]

		// Context
		var prevTag POS = Other
		if i > 0 {
			prevTag = tags[i-1]
		}

		// Rule 1: Determiner/Adjective force Noun
		// "The [run]", "A fast [attack]"
		// If current is Verb-like but preceded by Modifier/Det, it's likely a Noun
		if (prevTag == Determiner || prevTag.IsModifier()) && currentTag.IsVerbal() {
			// Special check: Don't convert "is/was" etc? No, lexicon handles those firmly.
			// This works best for ambiguous words like "run", "attack", "play"
			tags[i] = Noun
			continue
		}

		// Rule 2: Modal forces Verb
		// "can [run]", "will [attack]"
		if prevTag == Modal && currentTag.IsNominal() {
			tags[i] = Verb
			continue
		}

		// Rule 3: "To" forces Verb (Infinitive marker)
		// "want to [run]"
		if i > 0 && strings.ToLower(words[i-1]) == "to" && currentTag.IsNominal() {
			tags[i] = Verb
			continue
		}

		// Rule 4: "Of" forces Noun
		// "Word of [honor]"
		if i > 0 && strings.ToLower(words[i-1]) == "of" && currentTag.IsVerbal() {
			tags[i] = Noun
			continue
		}

		// Rule 5: Proper Noun Reinforcement
		// If capitalized and not at start of sentence?
		// (Simplistic implementation: relies on inferPOS logic which checks caps)

		// Fix punctuations that slipped through?
		if len(currentWord) == 1 && unicode.IsPunct(rune(currentWord[0])) {
			tags[i] = Punctuation
		}
	}

	return tags
}

func (t *Tagger) lookupBaseline(word string) POS {
	lower := strings.ToLower(word)

	// Check lexicon
	if pos, ok := t.lexicon[lower]; ok {
		return pos
	}

	// Infer from heuristics
	return t.inferPOS(word)
}

func (t *Tagger) inferPOS(word string) POS {
	lower := strings.ToLower(word)

	// Single punctuation
	if len(word) == 1 {
		ch := rune(word[0])
		if unicode.IsPunct(ch) {
			return Punctuation
		}
	}

	// Proper noun: starts with uppercase
	if len(word) > 0 && unicode.IsUpper(rune(word[0])) {
		return ProperNoun
	}

	// Suffix heuristics
	if strings.HasSuffix(lower, "ly") {
		return Adverb
	}
	if strings.HasSuffix(lower, "ing") || strings.HasSuffix(lower, "ed") || strings.HasSuffix(lower, "en") {
		return Verb
	}
	if strings.HasSuffix(lower, "ness") || strings.HasSuffix(lower, "tion") ||
		strings.HasSuffix(lower, "ment") || strings.HasSuffix(lower, "ity") ||
		strings.HasSuffix(lower, "er") || strings.HasSuffix(lower, "or") {
		return Noun
	}
	if strings.HasSuffix(lower, "ful") || strings.HasSuffix(lower, "less") ||
		strings.HasSuffix(lower, "ous") || strings.HasSuffix(lower, "ive") ||
		strings.HasSuffix(lower, "able") || strings.HasSuffix(lower, "ible") {
		return Adjective
	}

	// Default: noun
	return Noun
}

func (t *Tagger) loadDefaultLexicon() {
	// Determiners
	for _, w := range []string{"the", "a", "an", "this", "that", "these", "those", "my", "your",
		"his", "her", "its", "our", "their", "some", "any", "no", "every", "each", "all", "both",
		"few", "many", "much", "most", "other"} {
		t.lexicon[w] = Determiner
	}

	// Prepositions
	for _, w := range []string{"in", "on", "at", "to", "for", "with", "by", "from", "of", "about",
		"into", "through", "during", "before", "after", "above", "below", "between", "under", "over",
		"against", "among", "around", "behind", "beside", "beyond", "near", "toward", "towards",
		"upon", "within", "without", "across", "along", "inside", "outside", "throughout"} {
		t.lexicon[w] = Preposition
	}

	// Auxiliaries
	for _, w := range []string{"is", "are", "was", "were", "be", "been", "being", "am",
		"have", "has", "had", "having", "do", "does", "did", "doing"} {
		t.lexicon[w] = Auxiliary
	}

	// Modals
	for _, w := range []string{"can", "could", "will", "would", "shall", "should", "may", "might", "must"} {
		t.lexicon[w] = Modal
	}

	// Conjunctions
	for _, w := range []string{"and", "or", "but", "nor", "yet", "so", "because", "although",
		"while", "if", "unless", "until", "since", "when", "where", "whether"} {
		t.lexicon[w] = Conjunction
	}

	// Pronouns
	for _, w := range []string{"i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them",
		"myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves"} {
		t.lexicon[w] = Pronoun
	}

	// Relative pronouns
	for _, w := range []string{"who", "whom", "whose", "which", "that"} {
		t.lexicon[w] = RelativePronoun
	}

	// Common adjectives
	for _, w := range []string{"old", "new", "good", "bad", "great", "small", "large", "big", "little",
		"young", "long", "short", "high", "low", "early", "late", "first", "last", "ancient", "dark",
		"bright", "powerful", "mighty", "wise", "evil", "grey", "black", "white", "red", "blue",
		"green", "golden", "silver"} {
		t.lexicon[w] = Adjective
	}

	// Common adverbs
	for _, w := range []string{"very", "quite", "rather", "really", "too", "just", "only",
		"now", "then", "here", "there", "always", "never", "often", "sometimes", "slowly",
		"quickly", "suddenly", "finally", "already", "still", "even"} {
		t.lexicon[w] = Adverb
	}

	// Common verbs
	for _, w := range []string{"go", "went", "gone", "going", "come", "came", "coming",
		"say", "said", "saying", "see", "saw", "seen", "seeing", "know", "knew", "known", "knowing",
		"take", "took", "taken", "taking", "get", "got", "getting", "make", "made", "making",
		"walk", "walked", "walking", "run", "ran", "running", "live", "lived", "living",
		"speak", "spoke", "spoken", "speaking", "fight", "fought", "fighting", "kill", "killed",
		"killing", "love", "loved", "loving", "hate", "hated", "hating", "rule", "ruled", "ruling",
		"serve", "served", "serving", "attack"} { // Explicitly added "attack" as base verb
		t.lexicon[w] = Verb
	}

	// Common nouns
	for _, w := range []string{"wizard", "king", "queen", "knight", "dragon", "sword", "castle",
		"forest", "tower", "ring", "magic", "battle", "kingdom", "throne", "warrior", "mage",
		"elf", "dwarf", "orc", "goblin", "troll", "man", "woman", "child", "hero", "villain",
		"stranger", "lord", "lady"} {
		t.lexicon[w] = Noun
	}
}
