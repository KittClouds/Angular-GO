// Package syntax provides regex-based pattern detection.
// It detects Wikilinks, Explicit Entities, Triples, Tags, and Mentions.
package syntax

// SyntaxKind distinguishes the type of syntax match
type SyntaxKind int

const (
	KindWikilink SyntaxKind = iota
	KindBacklink
	KindEntity
	KindTriple
	KindInlineRelation
	KindTag
	KindMention
)

// SyntaxMatch represents a detected pattern
type SyntaxMatch struct {
	Start    int
	End      int
	Text     string
	Kind     SyntaxKind
	Original string
	// Matched components
	Target      string // For wikilink/backlink
	Label       string // For all
	EntityKind  string // For explicit entity
	Subtype     string // For explicit entity
	Predicate   string // For triples/relations
	Subject     string // For triples
	SubjectKind string // For triples
	Object      string // For triples
	ObjectKind  string // For triples
}

// SyntaxScanner holds configuration (now stateless/regex-free)
type SyntaxScanner struct {
}

// New creates a scanner
func New() *SyntaxScanner {
	return &SyntaxScanner{}
}
