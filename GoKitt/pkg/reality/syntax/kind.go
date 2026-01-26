package syntax

// SyntaxKind represents the semantic type of a node
type SyntaxKind uint16

const (
	// Technical
	KindError       SyntaxKind = 0
	KindRoot        SyntaxKind = 1
	KindWhitespace  SyntaxKind = 2
	KindText        SyntaxKind = 3
	KindPunctuation SyntaxKind = 4
	KindWord        SyntaxKind = 5

	// Structure
	KindDocument  SyntaxKind = 10
	KindSection   SyntaxKind = 11
	KindParagraph SyntaxKind = 12
	KindSentence  SyntaxKind = 13

	// Phrases (Chunker)
	KindNounPhrase SyntaxKind = 20
	KindVerbPhrase SyntaxKind = 21
	KindPrepPhrase SyntaxKind = 22
	KindAdjPhrase  SyntaxKind = 23

	// Semantic Spans
	KindEntitySpan   SyntaxKind = 30
	KindConceptSpan  SyntaxKind = 31
	KindRelationSpan SyntaxKind = 32

	// Links
	KindWikilink SyntaxKind = 40
	KindBacklink SyntaxKind = 41
	KindTriple   SyntaxKind = 42

	// Clauses
	KindMainClause SyntaxKind = 50
	KindSubClause  SyntaxKind = 51
)

func (k SyntaxKind) String() string {
	switch k {
	case KindError:
		return "Error"
	case KindRoot:
		return "Root"
	case KindWhitespace:
		return "Whitespace"
	case KindText:
		return "Text"
	case KindPunctuation:
		return "Punctuation"
	case KindWord:
		return "Word"
	case KindDocument:
		return "Document"
	case KindSection:
		return "Section"
	case KindParagraph:
		return "Paragraph"
	case KindSentence:
		return "Sentence"
	case KindNounPhrase:
		return "NounPhrase"
	case KindVerbPhrase:
		return "VerbPhrase"
	case KindPrepPhrase:
		return "PrepPhrase"
	case KindEntitySpan:
		return "EntitySpan"
	default:
		return "Unknown"
	}
}
