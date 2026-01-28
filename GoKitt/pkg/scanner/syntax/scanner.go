package syntax

import (
	"strings"
	"unicode"
)

// Single-pass scanner to replace regexes
type fastScanner struct {
	text string
	n    int
}

func (s *SyntaxScanner) Scan(text string) []SyntaxMatch {
	fs := fastScanner{text: text, n: len(text)}
	var matches []SyntaxMatch
	i := 0

	for i < fs.n {
		// Optimization: Skip until next potential trigger
		// Triggers: [, <, #, @
		nextTrigger := strings.IndexAny(text[i:], "[<#@")
		if nextTrigger == -1 {
			break
		}
		i += nextTrigger

		// Analyze trigger
		char := text[i]
		switch char {
		case '[':
			// Could be Wikilink [[...]] or Entity [Kind:...] or Triple [Sub] -[Pred]-> [Obj]
			// Or just [text].

			// 1. Check Wikilink [[
			if i+1 < fs.n && text[i+1] == '[' {
				if m := fs.tryWikilink(i); m != nil {
					matches = append(matches, *m)
					i = m.End // Skip past
					continue
				}
			}

			// 2. Check Entity-like or Triple start
			// Parse [Content]
			bracketMatch := fs.parseBracketed(i)
			if bracketMatch == nil {
				// Just an open bracket, continue
				i++
				continue
			}

			// We have [Content].
			// Check if it is followed by -[ (Triple)
			// Needs whitespace check? Regex says: \s*-\[
			nextPos := bracketMatch.end
			isTriple := false

			// Scan ahead for -[
			tripleStart := nextPos
			for tripleStart < fs.n && unicode.IsSpace(rune(text[tripleStart])) {
				tripleStart++
			}
			if tripleStart+1 < fs.n && text[tripleStart] == '-' && text[tripleStart+1] == '[' {
				// Potential triple. Try to parse full triple.
				if t := fs.tryTriple(i, bracketMatch, tripleStart); t != nil {
					matches = append(matches, *t)
					i = t.End
					isTriple = true
				}
			}

			if !isTriple {
				// Analyze the bracket content for Entity or InlineRelation
				// bracketMatch has inner content.
				// Content must match: Kind[|:]Label...
				if ent := fs.analyzeEntity(bracketMatch); ent != nil {
					matches = append(matches, *ent)
					i = bracketMatch.end // Skip past ]
				} else {
					// Not an entity (e.g. [Just Text]), consume [
					i++
				}
			} else {
				// Handled as triple
				continue
			}

		case '<':
			// Check Backlink <<
			if i+1 < fs.n && text[i+1] == '<' {
				if m := fs.tryBacklink(i); m != nil {
					matches = append(matches, *m)
					i = m.End
					continue
				}
			}
			i++

		case '#':
			// Tag
			// Check preceding char is not & (HTML check from regex)
			if i > 0 && text[i-1] == '&' {
				i++
				continue
			}
			// Boundary check: (?:^|[^&]) - but typically tags start word?
			// The regex `(?:^|[^&])#([\w\-/]+)` accepts `foo#tag` as long as not `&`.
			// It allows `#tag` anywhere unless preceded by `&`.
			if m := fs.tryTag(i); m != nil {
				matches = append(matches, *m)
				i = m.End
			} else {
				i++

			}

		case '@':
			// Mention
			if m := fs.tryMention(i); m != nil {
				matches = append(matches, *m)
				i = m.End
			} else {
				i++
			}
		default:
			i++
		}
	}

	return matches
}

// Helpers

type bracketBlock struct {
	start   int
	end     int // after ]
	content string
}

func (fs *fastScanner) parseBracketed(start int) *bracketBlock {
	// Assumes text[start] == '['
	// Scan until ']'
	for k := start + 1; k < fs.n; k++ {
		if fs.text[k] == ']' {
			return &bracketBlock{
				start:   start,
				end:     k + 1,
				content: fs.text[start+1 : k],
			}
		}
		// Do we allow nesting? Regex `[^\]]+` implies NO nesting.
	}
	return nil
}

func (fs *fastScanner) tryWikilink(start int) *SyntaxMatch {
	// [[Target]] or [[Target|Label]]
	// Find closing ]]
	end := -1
	for k := start + 2; k < fs.n-1; k++ {
		if fs.text[k] == ']' && fs.text[k+1] == ']' {
			end = k + 2
			break
		}
	}
	if end == -1 {
		return nil
	}

	content := fs.text[start+2 : end-2]
	// Split by |
	parts := strings.SplitN(content, "|", 2)
	target := strings.TrimSpace(parts[0]) // Regex `[^|\]]+` excludes | and ]
	// Regex doesn't trimming space? `\[\[([^|\]]+)...` matches literally.
	// But let's assume raw match for now.
	target = parts[0]

	label := target
	if len(parts) > 1 {
		label = parts[1]
	}

	// Wikilink validation: Target must be non-empty? Regex says `+`.
	if len(target) == 0 {
		return nil
	}

	return &SyntaxMatch{
		Start:    start,
		End:      end,
		Text:     fs.text[start:end],
		Original: fs.text[start:end],
		Kind:     KindWikilink,
		Target:   target,
		Label:    label,
	}
}

func (fs *fastScanner) tryBacklink(start int) *SyntaxMatch {
	// <<Target>> or <<Target|Label>>
	// Find closing >>
	end := -1
	for k := start + 2; k < fs.n-1; k++ {
		if fs.text[k] == '>' && fs.text[k+1] == '>' {
			end = k + 2
			break
		}
	}
	if end == -1 {
		return nil
	}

	content := fs.text[start+2 : end-2]
	parts := strings.SplitN(content, "|", 2)
	target := parts[0]
	label := target
	if len(parts) > 1 {
		label = parts[1]
	}

	if len(target) == 0 {
		return nil
	}

	// Regex `[^|>]+` implies target cannot contain > or |.

	return &SyntaxMatch{
		Start:    start,
		End:      end,
		Text:     fs.text[start:end],
		Original: fs.text[start:end],
		Kind:     KindBacklink,
		Target:   target,
		Label:    label,
	}
}

func (fs *fastScanner) analyzeEntity(block *bracketBlock) *SyntaxMatch {
	// block.content is inside [ ... ]
	// Patterns:
	// Entity: [Kind:Label] or [Kind|Label] (Subtype opt)
	// Inline: [Kind:Label@Predicate]

	// Valid Kind chars: [#@!]?[a-zA-Z0-9_-]+
	// Separators: | or :

	// Find first separator
	sepIdx := strings.IndexAny(block.content, "|:")
	if sepIdx == -1 {
		return nil
	}

	kindPart := block.content[:sepIdx]
	remainder := block.content[sepIdx+1:]

	// Validate Kind
	if !isValidKind(kindPart) {
		return nil
	}

	// Check for Inline Relation @ in remainder
	// Rule: [Kind:Label@Predicate]
	// Label cannot contain @ if it's an inline relation target?
	// The regex `[^@\]]+` for label in inline relation implies Label stops at @.

	atIdx := strings.IndexByte(remainder, '@')
	if atIdx != -1 {
		// INLINE RELATION
		label := remainder[:atIdx]
		pred := remainder[atIdx+1:]

		if len(label) == 0 || len(pred) == 0 {
			return nil
		}

		return &SyntaxMatch{
			Start:      block.start,
			End:        block.end,
			Text:       fs.text[block.start:block.end],
			Original:   fs.text[block.start:block.end],
			Kind:       KindInlineRelation,
			EntityKind: kindPart,
			Label:      label,
			Predicate:  pred,
		}
	}

	// ENTITY
	// remainder might contain Subtype sep matching | or : again
	// Regex: `([^\]|:]+)(?:[|:]([^\]]+))?`

	nextSep := strings.IndexAny(remainder, "|:")
	label := remainder
	subtype := ""

	if nextSep != -1 {
		label = remainder[:nextSep]
		subtype = remainder[nextSep+1:]
	}

	if len(label) == 0 {
		return nil
	}

	return &SyntaxMatch{
		Start:      block.start,
		End:        block.end,
		Text:       fs.text[block.start:block.end],
		Original:   fs.text[block.start:block.end],
		Kind:       KindEntity,
		EntityKind: kindPart,
		Label:      label,
		Subtype:    subtype,
	}
}

func (fs *fastScanner) tryTriple(start int, subjBlock *bracketBlock, arrowStart int) *SyntaxMatch {
	// We parse Subject [Subj] already in subjBlock.
	// We are at arrowStart pointing to '-'.
	// arrowStart must match `-[Pred]->`
	// Find next `]->`
	// Scan from arrowStart+2

	// Check `-[`
	// Already checked in loop, but verify safe access
	// Parse Predicate
	predEnd := -1
	// Looking for `]->`
	for k := arrowStart + 2; k < fs.n-2; k++ {
		if fs.text[k] == ']' && fs.text[k+1] == '-' && fs.text[k+2] == '>' {
			predEnd = k
			break
		}
	}

	if predEnd == -1 {
		return nil
	}

	predicate := fs.text[arrowStart+2 : predEnd]
	if len(predicate) == 0 {
		return nil
	}
	// Regex `[^\]]+` implies no closing bracket in predicate.

	// Whitespace after arrow? `\s*\[`
	objStart := predEnd + 3 // After `]->`
	for objStart < fs.n && unicode.IsSpace(rune(fs.text[objStart])) {
		objStart++
	}

	if objStart >= fs.n || fs.text[objStart] != '[' {
		return nil
	}

	// Parse Object [Obj]
	objBlock := fs.parseBracketed(objStart)
	if objBlock == nil {
		return nil
	}

	// Extract Subject Kind/Label
	subjEnt := fs.analyzeEntity(subjBlock)
	if subjEnt == nil || subjEnt.Kind != KindEntity {
		return nil
	}

	// Extract Object Kind/Label
	objEnt := fs.analyzeEntity(objBlock)
	if objEnt == nil || objEnt.Kind != KindEntity {
		return nil
	}

	return &SyntaxMatch{
		Start:       start,
		End:         objBlock.end,
		Text:        fs.text[start:objBlock.end],
		Original:    fs.text[start:objBlock.end],
		Kind:        KindTriple,
		SubjectKind: subjEnt.EntityKind,
		Subject:     subjEnt.Label,
		Predicate:   predicate,
		ObjectKind:  objEnt.EntityKind,
		Object:      objEnt.Label,
	}
}

func (fs *fastScanner) tryTag(start int) *SyntaxMatch {
	// #tag
	// Scan \w\- or /
	// Regex: `([\w\-/]+)`
	k := start + 1
	for k < fs.n {
		r := rune(fs.text[k])
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '/' {
			k++
		} else {
			break
		}
	}

	label := fs.text[start+1 : k]
	if len(label) == 0 {
		return nil
	}

	return &SyntaxMatch{
		Start:    start,
		End:      k,
		Text:     fs.text[start:k],
		Original: fs.text[start:k], // Assuming we only capture the tag part as original?
		// Regex `tagRe` match[0] starts at # (or char before).
		// scanTags returns Start/End of the #tag part.
		Kind:  KindTag,
		Label: label,
	}
}

func (fs *fastScanner) tryMention(start int) *SyntaxMatch {
	// @mention
	// Regex: `(@([\w\-]+))`
	k := start + 1
	for k < fs.n {
		r := rune(fs.text[k])
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			k++
		} else {
			break
		}
	}

	label := fs.text[start+1 : k]
	if len(label) == 0 {
		return nil
	}

	return &SyntaxMatch{
		Start:    start,
		End:      k,
		Text:     fs.text[start:k],
		Original: fs.text[start:k],
		Kind:     KindMention,
		Label:    label,
	}
}

func isValidKind(s string) bool {
	// Regex: `[#@!]?[a-zA-Z0-9_-]+`
	if len(s) == 0 {
		return false
	}

	start := 0
	if s[0] == '#' || s[0] == '@' || s[0] == '!' {
		start = 1
	}

	if start >= len(s) {
		return false
	}

	for i := start; i < len(s); i++ {
		r := rune(s[i])
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-') {
			return false
		}
	}
	return true
}
