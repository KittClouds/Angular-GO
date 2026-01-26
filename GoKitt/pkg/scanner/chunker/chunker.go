// Package chunker implements rule-based phrase chunking for NP/VP/PP detection.
// This is the central text analysis component, ported from chunker.rs.
package chunker

import (
	"strings"
	"unicode"
)

// ============================================================================
// TextRange
// ============================================================================

// TextRange represents a byte offset span in text
type TextRange struct {
	Start int
	End   int
}

// NewRange creates a new TextRange
func NewRange(start, end int) TextRange {
	return TextRange{Start: start, End: end}
}

// Len returns the length of the range
func (r TextRange) Len() int {
	return r.End - r.Start
}

// IsEmpty returns true if the range is empty
func (r TextRange) IsEmpty() bool {
	return r.Start >= r.End
}

// Slice extracts the text covered by this range
func (r TextRange) Slice(text string) string {
	if r.Start < 0 || r.End > len(text) || r.Start > r.End {
		return ""
	}
	return text[r.Start:r.End]
}

// Contains checks if this range contains another
func (r TextRange) Contains(other TextRange) bool {
	return r.Start <= other.Start && r.End >= other.End
}

// Overlaps checks if ranges overlap
func (r TextRange) Overlaps(other TextRange) bool {
	return r.Start < other.End && other.Start < r.End
}

// ============================================================================
// POS (Part of Speech)
// ============================================================================

// POS represents a part-of-speech tag
type POS int

const (
	Noun POS = iota
	Pronoun
	ProperNoun
	Verb
	Auxiliary
	Modal
	Adjective
	Adverb
	Determiner
	Preposition
	Conjunction
	RelativePronoun
	Punctuation
	Other
)

// IsNominal returns true if the POS is noun-like
func (p POS) IsNominal() bool {
	return p == Noun || p == Pronoun || p == ProperNoun
}

// IsVerbal returns true if the POS is verb-like
func (p POS) IsVerbal() bool {
	return p == Verb || p == Auxiliary || p == Modal
}

// IsModifier returns true if the POS is a modifier
func (p POS) IsModifier() bool {
	return p == Adjective || p == Adverb
}

// ============================================================================
// Token
// ============================================================================

// Token is a tagged word in text
type Token struct {
	Text  string
	POS   POS
	Range TextRange
}

// ============================================================================
// ChunkKind
// ============================================================================

// ChunkKind represents the type of phrase chunk
type ChunkKind int

const (
	NounPhrase ChunkKind = iota
	VerbPhrase
	PrepPhrase
	AdjPhrase
	Clause
)

// String returns a readable name
func (k ChunkKind) String() string {
	switch k {
	case NounPhrase:
		return "NP"
	case VerbPhrase:
		return "VP"
	case PrepPhrase:
		return "PP"
	case AdjPhrase:
		return "ADJP"
	case Clause:
		return "CLAUSE"
	default:
		return "UNKNOWN"
	}
}

// ============================================================================
// Chunk
// ============================================================================

// Chunk is a detected phrase
type Chunk struct {
	Kind      ChunkKind
	Range     TextRange
	Head      TextRange   // The head word of the phrase
	Modifiers []TextRange // Det, Adj, Adv, etc.
}

// HeadText extracts the head word text
func (c *Chunk) HeadText(source string) string {
	return c.Head.Slice(source)
}

// Text extracts the full chunk text
func (c *Chunk) Text(source string) string {
	return c.Range.Slice(source)
}

// ============================================================================
// ChunkResult
// ============================================================================

// ChunkResult holds the output of chunking
type ChunkResult struct {
	Chunks []Chunk
	Tokens []Token
}

// ============================================================================
// Chunker
// ============================================================================

// Chunker performs rule-based phrase detection
type Chunker struct {
	lexicon map[string]POS
}

// New creates a Chunker with the default English lexicon
func New() *Chunker {
	c := &Chunker{
		lexicon: make(map[string]POS),
	}
	c.loadDefaultLexicon()
	return c
}

// Chunk processes text and returns detected phrases
func (c *Chunker) Chunk(text string) ChunkResult {
	// Step 1: Tokenize
	ranges := c.tokenize(text)

	// Step 2: Tag POS
	tokens := c.tagTokens(ranges, text)

	// Step 3: Find chunks
	chunks := c.findChunks(tokens, text)

	return ChunkResult{Chunks: chunks, Tokens: tokens}
}

// ============================================================================
// Tokenization
// ============================================================================

func (c *Chunker) tokenize(text string) []TextRange {
	var tokens []TextRange
	var start int = -1

	for i, ch := range text {
		if unicode.IsLetter(ch) || unicode.IsDigit(ch) || ch == '\'' || ch == '-' {
			// Inside a word
			if start == -1 {
				start = i
			}
		} else {
			// End of word
			if start != -1 {
				tokens = append(tokens, NewRange(start, i))
				start = -1
			}
			// Punctuation as separate token
			if unicode.IsPunct(ch) {
				tokens = append(tokens, NewRange(i, i+len(string(ch))))
			}
		}
	}
	// Handle trailing word
	if start != -1 {
		tokens = append(tokens, NewRange(start, len(text)))
	}
	return tokens
}

// ============================================================================
// POS Tagging
// ============================================================================

func (c *Chunker) tagTokens(ranges []TextRange, text string) []Token {
	tokens := make([]Token, 0, len(ranges))
	for _, r := range ranges {
		word := r.Slice(text)
		pos := c.lookupPOS(word)
		tokens = append(tokens, Token{Text: word, POS: pos, Range: r})
	}
	return tokens
}

func (c *Chunker) lookupPOS(word string) POS {
	lower := strings.ToLower(word)

	// Check lexicon
	if pos, ok := c.lexicon[lower]; ok {
		return pos
	}

	// Infer from heuristics
	return c.inferPOS(word)
}

func (c *Chunker) inferPOS(word string) POS {
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

// ============================================================================
// Chunk Finding
// ============================================================================

func (c *Chunker) findChunks(tokens []Token, text string) []Chunk {
	var chunks []Chunk
	i := 0

	for i < len(tokens) {
		// Skip punctuation
		if tokens[i].POS == Punctuation {
			i++
			continue
		}

		// Try patterns in priority order
		if chunk, consumed := c.tryPrepPhrase(tokens, i); consumed > 0 {
			chunks = append(chunks, chunk)
			i += consumed
		} else if chunk, consumed := c.tryVerbPhrase(tokens, i); consumed > 0 {
			chunks = append(chunks, chunk)
			i += consumed
		} else if chunk, consumed := c.tryNounPhrase(tokens, i); consumed > 0 {
			chunks = append(chunks, chunk)
			i += consumed
		} else if chunk, consumed := c.tryAdjPhrase(tokens, i); consumed > 0 {
			chunks = append(chunks, chunk)
			i += consumed
		} else if chunk, consumed := c.tryClause(tokens, i); consumed > 0 {
			chunks = append(chunks, chunk)
			i += consumed
		} else {
			i++
		}
	}

	return chunks
}

// tryNounPhrase: Det? Adj* Noun+
func (c *Chunker) tryNounPhrase(tokens []Token, start int) (Chunk, int) {
	i := start
	var modifiers []TextRange

	// Optional determiner
	if i < len(tokens) && tokens[i].POS == Determiner {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	// Zero or more adjectives
	for i < len(tokens) && tokens[i].POS == Adjective {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	// One or more nominals
	nounStart := i
	for i < len(tokens) && tokens[i].POS.IsNominal() {
		i++
	}

	if i > nounStart {
		head := tokens[i-1].Range
		rng := NewRange(tokens[start].Range.Start, tokens[i-1].Range.End)
		return Chunk{Kind: NounPhrase, Range: rng, Head: head, Modifiers: modifiers}, i - start
	}

	return Chunk{}, 0
}

// tryVerbPhrase: Aux? Adv* Verb Adv*
func (c *Chunker) tryVerbPhrase(tokens []Token, start int) (Chunk, int) {
	i := start
	var modifiers []TextRange
	headIdx := -1

	// Optional auxiliary/modal
	if i < len(tokens) && (tokens[i].POS == Auxiliary || tokens[i].POS == Modal) {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	// Pre-verb adverbs
	for i < len(tokens) && tokens[i].POS == Adverb {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	// Main verb (required)
	if i < len(tokens) && tokens[i].POS == Verb {
		headIdx = i
		i++
	} else {
		return Chunk{}, 0
	}

	// Post-verb adverbs
	for i < len(tokens) && tokens[i].POS == Adverb {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	head := tokens[headIdx].Range
	rng := NewRange(tokens[start].Range.Start, tokens[i-1].Range.End)
	return Chunk{Kind: VerbPhrase, Range: rng, Head: head, Modifiers: modifiers}, i - start
}

// tryPrepPhrase: Prep NP
func (c *Chunker) tryPrepPhrase(tokens []Token, start int) (Chunk, int) {
	if start >= len(tokens) || tokens[start].POS != Preposition {
		return Chunk{}, 0
	}

	prep := tokens[start]
	np, npConsumed := c.tryNounPhrase(tokens, start+1)
	if npConsumed == 0 {
		return Chunk{}, 0
	}

	rng := NewRange(prep.Range.Start, np.Range.End)
	modifiers := append([]TextRange{np.Head}, np.Modifiers...)
	return Chunk{Kind: PrepPhrase, Range: rng, Head: prep.Range, Modifiers: modifiers}, 1 + npConsumed
}

// tryAdjPhrase: Adv* Adj (only if intensifiers present)
func (c *Chunker) tryAdjPhrase(tokens []Token, start int) (Chunk, int) {
	i := start
	var modifiers []TextRange

	// Intensifier adverbs
	for i < len(tokens) && tokens[i].POS == Adverb {
		modifiers = append(modifiers, tokens[i].Range)
		i++
	}

	// Must have adjective
	if i >= len(tokens) || tokens[i].POS != Adjective {
		return Chunk{}, 0
	}

	head := tokens[i].Range
	i++

	// Only create ADJP if there are intensifiers
	if len(modifiers) == 0 {
		return Chunk{}, 0
	}

	rng := NewRange(tokens[start].Range.Start, tokens[i-1].Range.End)
	return Chunk{Kind: AdjPhrase, Range: rng, Head: head, Modifiers: modifiers}, i - start
}

// tryClause: RelPronoun VP (NP)?
func (c *Chunker) tryClause(tokens []Token, start int) (Chunk, int) {
	if start >= len(tokens) || tokens[start].POS != RelativePronoun {
		return Chunk{}, 0
	}

	rel := tokens[start]
	i := start + 1

	vp, vpConsumed := c.tryVerbPhrase(tokens, i)
	if vpConsumed == 0 {
		return Chunk{}, 0
	}
	i += vpConsumed
	end := vp.Range.End

	// Optional NP after VP
	np, npConsumed := c.tryNounPhrase(tokens, i)
	if npConsumed > 0 {
		end = np.Range.End
		i += npConsumed
	}

	rng := NewRange(rel.Range.Start, end)
	return Chunk{Kind: Clause, Range: rng, Head: vp.Head, Modifiers: []TextRange{rel.Range}}, i - start
}

// ============================================================================
// Default Lexicon
// ============================================================================

func (c *Chunker) loadDefaultLexicon() {
	// Determiners
	for _, w := range []string{"the", "a", "an", "this", "that", "these", "those", "my", "your",
		"his", "her", "its", "our", "their", "some", "any", "no", "every", "each", "all", "both",
		"few", "many", "much", "most", "other"} {
		c.lexicon[w] = Determiner
	}

	// Prepositions
	for _, w := range []string{"in", "on", "at", "to", "for", "with", "by", "from", "of", "about",
		"into", "through", "during", "before", "after", "above", "below", "between", "under", "over",
		"against", "among", "around", "behind", "beside", "beyond", "near", "toward", "towards",
		"upon", "within", "without", "across", "along", "inside", "outside", "throughout"} {
		c.lexicon[w] = Preposition
	}

	// Auxiliaries
	for _, w := range []string{"is", "are", "was", "were", "be", "been", "being", "am",
		"have", "has", "had", "having", "do", "does", "did", "doing"} {
		c.lexicon[w] = Auxiliary
	}

	// Modals
	for _, w := range []string{"can", "could", "will", "would", "shall", "should", "may", "might", "must"} {
		c.lexicon[w] = Modal
	}

	// Conjunctions
	for _, w := range []string{"and", "or", "but", "nor", "yet", "so", "because", "although",
		"while", "if", "unless", "until", "since", "when", "where", "whether"} {
		c.lexicon[w] = Conjunction
	}

	// Pronouns
	for _, w := range []string{"i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them",
		"myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves"} {
		c.lexicon[w] = Pronoun
	}

	// Relative pronouns
	for _, w := range []string{"who", "whom", "whose", "which", "that"} {
		c.lexicon[w] = RelativePronoun
	}

	// Common adjectives
	for _, w := range []string{"old", "new", "good", "bad", "great", "small", "large", "big", "little",
		"young", "long", "short", "high", "low", "early", "late", "first", "last", "ancient", "dark",
		"bright", "powerful", "mighty", "wise", "evil", "grey", "black", "white", "red", "blue",
		"green", "golden", "silver"} {
		c.lexicon[w] = Adjective
	}

	// Common adverbs
	for _, w := range []string{"very", "quite", "rather", "really", "too", "just", "only",
		"now", "then", "here", "there", "always", "never", "often", "sometimes", "slowly",
		"quickly", "suddenly", "finally", "already", "still", "even"} {
		c.lexicon[w] = Adverb
	}

	// Common verbs
	for _, w := range []string{"go", "went", "gone", "going", "come", "came", "coming",
		"say", "said", "saying", "see", "saw", "seen", "seeing", "know", "knew", "known", "knowing",
		"take", "took", "taken", "taking", "get", "got", "getting", "make", "made", "making",
		"walk", "walked", "walking", "run", "ran", "running", "live", "lived", "living",
		"speak", "spoke", "spoken", "speaking", "fight", "fought", "fighting", "kill", "killed",
		"killing", "love", "loved", "loving", "hate", "hated", "hating", "rule", "ruled", "ruling",
		"serve", "served", "serving"} {
		c.lexicon[w] = Verb
	}

	// Common nouns
	for _, w := range []string{"wizard", "king", "queen", "knight", "dragon", "sword", "castle",
		"forest", "tower", "ring", "magic", "battle", "kingdom", "throne", "warrior", "mage",
		"elf", "dwarf", "orc", "goblin", "troll", "man", "woman", "child", "hero", "villain",
		"stranger", "lord", "lady"} {
		c.lexicon[w] = Noun
	}
}
