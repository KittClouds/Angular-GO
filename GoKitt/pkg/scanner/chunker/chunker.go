// Package chunker implements rule-based phrase chunking for NP/VP/PP detection.
// This is the central text analysis component, ported from chunker.rs.
package chunker

import (
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
	Mask   *IntervalMask // The mask used during chunking (for debugging/visualization)
}

// ============================================================================
// Chunker
// ============================================================================

// Chunker performs rule-based phrase detection
type Chunker struct {
	tagger *Tagger
}

// New creates a Chunker with the default English lexicon
func New() *Chunker {
	return &Chunker{
		tagger: NewTagger(),
	}
}

// Chunk processes text and returns detected phrases.
// If mask is provided, locked entity spans are preserved as single tokens.
func (c *Chunker) Chunk(text string, mask *IntervalMask) ChunkResult {
	// Step 1: Tokenize with mask awareness
	ranges := c.tokenizeWithMask(text, mask)

	// Step 2: Tag POS (locked tokens get ProperNoun)
	tokens := c.tagTokensWithMask(ranges, text, mask)

	// Step 3: Find chunks
	chunks := c.findChunks(tokens)

	return ChunkResult{Chunks: chunks, Tokens: tokens, Mask: mask}
}

// ============================================================================
// Tokenization
// ============================================================================

// tokenizeWithMask splits text into tokens, respecting locked entity spans.
// If a position falls within a masked interval, the entire span becomes one token.
func (c *Chunker) tokenizeWithMask(text string, mask *IntervalMask) []TextRange {
	// Fast path: no mask or empty mask
	if mask == nil || mask.IsEmpty() {
		return c.tokenize(text)
	}

	tokens := make([]TextRange, 0, len(text)/6)
	i := 0

	for i < len(text) {
		// Check if position i is inside a masked interval
		if iv := mask.GetInterval(i); iv != nil {
			// Create single token for entire entity span
			tokens = append(tokens, NewRange(iv.Start, iv.End))
			i = iv.End
			continue
		}

		// Normal tokenization
		ch := rune(text[i])
		if unicode.IsLetter(ch) || unicode.IsDigit(ch) || ch == '\'' || ch == '-' {
			start := i
			for i < len(text) {
				r := rune(text[i])
				if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '\'' || r == '-') {
					break
				}
				i++
			}
			tokens = append(tokens, NewRange(start, i))
		} else if unicode.IsPunct(ch) {
			tokens = append(tokens, NewRange(i, i+1))
			i++
		} else {
			i++
		}
	}

	return tokens
}

// tokenize is the original tokenizer for backward compatibility
func (c *Chunker) tokenize(text string) []TextRange {
	// Heuristic: Average word length 5 + punctuation. ~1/6 of text len.
	tokens := make([]TextRange, 0, len(text)/6)
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

// tagTokensWithMask tags tokens, forcing ProperNoun for locked entity spans.
func (c *Chunker) tagTokensWithMask(ranges []TextRange, text string, mask *IntervalMask) []Token {
	// Fast path: no mask
	if mask == nil || mask.IsEmpty() {
		return c.tagTokens(ranges, text)
	}

	tokens := make([]Token, len(ranges))
	for i, r := range ranges {
		word := r.Slice(text)
		tokens[i] = Token{Text: word, Range: r}

		// Check if this token is a locked entity span
		if iv := mask.GetInterval(r.Start); iv != nil && iv.Start == r.Start && iv.End == r.End {
			// Locked entity: force ProperNoun
			tokens[i].POS = ProperNoun
		} else {
			// Normal tagging using baseline lookup
			tokens[i].POS = c.tagger.lookupBaseline(word)
		}
	}

	// Apply context reinforcement rules (from Tagger.Tag)
	for i := 0; i < len(tokens); i++ {
		currentTag := tokens[i].POS
		var prevTag POS = Other
		if i > 0 {
			prevTag = tokens[i-1].POS
		}

		// Skip locked tokens (ProperNoun from mask)
		if iv := mask.GetInterval(tokens[i].Range.Start); iv != nil && iv.Start == tokens[i].Range.Start {
			continue
		}

		// Rule: Determiner/Adjective force Noun
		if (prevTag == Determiner || prevTag.IsModifier()) && currentTag.IsVerbal() {
			tokens[i].POS = Noun
		}
		// Rule: Modal forces Verb
		if prevTag == Modal && currentTag.IsNominal() {
			tokens[i].POS = Verb
		}
	}

	return tokens
}

// tagTokens tags all tokens using the tagger (original method)
func (c *Chunker) tagTokens(ranges []TextRange, text string) []Token {
	// Extract words
	words := make([]string, len(ranges))
	for i, r := range ranges {
		words[i] = r.Slice(text)
	}

	// Tag them using the Tagger (Baseline + Context)
	posTags := c.tagger.Tag(words)

	// Combine into Tokens
	tokens := make([]Token, len(ranges))
	for i := 0; i < len(ranges); i++ {
		tokens[i] = Token{Text: words[i], POS: posTags[i], Range: ranges[i]}
	}

	return tokens
}

// ============================================================================
// Chunk Finding
// ============================================================================

func (c *Chunker) findChunks(tokens []Token) []Chunk {
	// Heuristic: Chunks are roughly 1/3 of tokens
	chunks := make([]Chunk, 0, len(tokens)/3)
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

	// Main verb (Simple Verb, or Auxiliary if no main verb found)
	if i < len(tokens) && tokens[i].POS == Verb {
		headIdx = i
		i++
	} else if headIdx == -1 && len(modifiers) > 0 {
		// If we saw Aux/Modal but no main Verb, treat the last Aux as the head (Copula-like behavior)
		// e.g. "is" in "is dangerous"
		headIdx = i - 1 // The last modifier was the Aux
		// Re-classify modifiers (remove the head from modifiers list)
		// This is a bit hacky, but simpler than rewriting the loop.
		// Actually, let's just accept it.
	} else {
		// Special Case: "is" appearing alone (Auxiliary)
		// If we haven't consumed anything distinctively verb-like, fail.
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
