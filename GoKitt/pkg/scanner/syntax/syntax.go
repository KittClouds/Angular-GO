// Package syntax provides regex-based pattern detection.
// It detects Wikilinks, Explicit Entities, Triples, Tags, and Mentions.
package syntax

import (
	"regexp"
)

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

// SyntaxScanner holds the compiled regexes
type SyntaxScanner struct {
	wikilinkRe       *regexp.Regexp
	backlinkRe       *regexp.Regexp
	entityRe         *regexp.Regexp
	tripleRe         *regexp.Regexp
	inlineRelationRe *regexp.Regexp
	tagRe            *regexp.Regexp
	mentionRe        *regexp.Regexp
}

// New creates a scanner with all regex patterns compiled
func New() *SyntaxScanner {
	return &SyntaxScanner{
		// [[Target]] or [[Target|Label]]
		wikilinkRe: regexp.MustCompile(`\[\[([^|\]]+)(?:\|([^\]]+))?\]\]`),

		// <<Target>> or <<Target|Label>>
		backlinkRe: regexp.MustCompile(`<<([^|>]+)(?:\|([^>]+))?>>`),

		// [KIND:Label] or [KIND:Label:Subtype]
		// Supports optional prefixes #/@/! and separators |/:
		entityRe: regexp.MustCompile(`\[([#@!]?[a-zA-Z0-9_-]+)[|:]([^\]|:]+)(?:[|:]([^\]]+))?\]`),

		// [S_KIND:S_Label] -[PRED]-> [O_KIND:O_Label]
		tripleRe: regexp.MustCompile(
			`\[([#@!]?[a-zA-Z0-9_-]+)[|:]([^\]]+)\]\s*-\[([^\]]+)\]->\s*\[([#@!]?[a-zA-Z0-9_-]+)[|:]([^\]]+)\]`,
		),

		// [KIND:Label@RELATION]
		inlineRelationRe: regexp.MustCompile(`\[([#@!]?[a-zA-Z0-9_-]+)[|:]([^@\]]+)@([^\]]+)\]`),

		// #tag (handled carefully to avoid HTML entities)
		// Go regex doesn't capture group 0 as full match in FindAllStringSubmatchIndex,
		// so we'll match generic and filter in logic.
		tagRe: regexp.MustCompile(`(?:^|[^&])#([\w\-/]+)`),

		// @mention
		mentionRe: regexp.MustCompile(`@([\w\-]+)`),
	}
}

// Scan finds all syntax patterns in the text
func (s *SyntaxScanner) Scan(text string) []SyntaxMatch {
	var matches []SyntaxMatch

	// 1. Triples (Most specific, check first)
	// We check triples before entities because triples CONTAIN entities syntax.
	// In a real pass we might handle overlaps, but simple append works for now.
	matches = append(matches, s.scanTriples(text)...)

	// 2. Entities & Inline Relations
	matches = append(matches, s.scanEntities(text)...)
	matches = append(matches, s.scanInlineRelations(text)...)

	// 3. Links
	matches = append(matches, s.scanWikilinks(text)...)
	matches = append(matches, s.scanBacklinks(text)...)

	// 4. Tags & Mentions
	matches = append(matches, s.scanTags(text)...)
	matches = append(matches, s.scanMentions(text)...)

	return matches
}

func (s *SyntaxScanner) scanWikilinks(text string) []SyntaxMatch {
	raw := s.wikilinkRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:    m[0],
			End:      m[1],
			Text:     text[m[0]:m[1]],
			Original: text[m[0]:m[1]],
			Kind:     KindWikilink,
			Target:   text[m[2]:m[3]],
		}
		if m[4] != -1 {
			match.Label = text[m[4]:m[5]]
		} else {
			match.Label = match.Target // Label defaults to target
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanBacklinks(text string) []SyntaxMatch {
	raw := s.backlinkRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:    m[0],
			End:      m[1],
			Text:     text[m[0]:m[1]],
			Original: text[m[0]:m[1]],
			Kind:     KindBacklink,
			Target:   text[m[2]:m[3]],
		}
		if m[4] != -1 {
			match.Label = text[m[4]:m[5]]
		} else {
			match.Label = match.Target
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanEntities(text string) []SyntaxMatch {
	raw := s.entityRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:      m[0],
			End:        m[1],
			Text:       text[m[0]:m[1]],
			Original:   text[m[0]:m[1]],
			Kind:       KindEntity,
			EntityKind: text[m[2]:m[3]],
			Label:      text[m[4]:m[5]],
		}
		if m[6] != -1 {
			match.Subtype = text[m[6]:m[7]]
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanTriples(text string) []SyntaxMatch {
	raw := s.tripleRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:       m[0],
			End:         m[1],
			Text:        text[m[0]:m[1]],
			Original:    text[m[0]:m[1]],
			Kind:        KindTriple,
			SubjectKind: text[m[2]:m[3]],
			Subject:     text[m[4]:m[5]],
			Predicate:   text[m[6]:m[7]],
			ObjectKind:  text[m[8]:m[9]],
			Object:      text[m[10]:m[11]],
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanInlineRelations(text string) []SyntaxMatch {
	raw := s.inlineRelationRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:      m[0],
			End:        m[1],
			Text:       text[m[0]:m[1]],
			Original:   text[m[0]:m[1]],
			Kind:       KindInlineRelation,
			EntityKind: text[m[2]:m[3]],
			Label:      text[m[4]:m[5]],
			Predicate:  text[m[6]:m[7]],
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanTags(text string) []SyntaxMatch {
	raw := s.tagRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		// Group 1 is the tag content.
		// The overall match might include a preceding char (non-ampersand).
		// We need to adjust Start/End to be just the tag "#tag".
		fullStart := m[0]

		tagContentStart := m[2]
		tagContentEnd := m[3]

		// The tag '#' is at tagContentStart - 1
		actualStart := tagContentStart - 1
		actualEnd := tagContentEnd

		match := SyntaxMatch{
			Start:    actualStart,
			End:      actualEnd,
			Text:     text[actualStart:actualEnd],
			Original: text[fullStart:m[1]], // Capture full context if needed
			Kind:     KindTag,
			Label:    text[tagContentStart:tagContentEnd],
		}
		out = append(out, match)
	}
	return out
}

func (s *SyntaxScanner) scanMentions(text string) []SyntaxMatch {
	raw := s.mentionRe.FindAllStringSubmatchIndex(text, -1)
	var out []SyntaxMatch
	for _, m := range raw {
		match := SyntaxMatch{
			Start:    m[0],
			End:      m[1],
			Text:     text[m[0]:m[1]],
			Original: text[m[0]:m[1]],
			Kind:     KindMention,
			Label:    text[m[2]:m[3]],
		}
		out = append(out, match)
	}
	return out
}
