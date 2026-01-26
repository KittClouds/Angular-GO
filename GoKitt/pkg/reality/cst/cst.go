package cst

import (
	"fmt"
	"strings"

	"github.com/kittclouds/gokitt/pkg/reality/syntax"
)

// TextRange represents a byte range in the source string.
// [Start, End) - End is exclusive.
type TextRange struct {
	Start int
	End   int
}

func (r TextRange) Len() int { return r.End - r.Start }

// Node is the primary struct. It is your "Red Node".
// It knows its kind, where it sits in the file, and who its children are.
type Node struct {
	Kind     syntax.SyntaxKind `json:"kind"`
	Range    TextRange         `json:"range"`
	Children []*Node           `json:"children,omitempty"`
	Parent   *Node             `json:"-"` // Backpointer (cycle) - Ignore in JSON
}

// Text extracts the actual string content from the source.
func (n *Node) Text(source string) string {
	if n.Range.Start < 0 || n.Range.End > len(source) || n.Range.Start > n.Range.End {
		return "<out of bounds>"
	}
	return source[n.Range.Start:n.Range.End]
}

// String provides a pretty-printed tree view for debugging.
func (n *Node) String(source string) string {
	var sb strings.Builder
	n.printRecursive(&sb, source, 0)
	return sb.String()
}

func (n *Node) printRecursive(sb *strings.Builder, source string, depth int) {
	indent := strings.Repeat("  ", depth)

	// Print Kind and Range
	fmt.Fprintf(sb, "%s%s [%d..%d]", indent, n.Kind, n.Range.Start, n.Range.End)

	// If it's a leaf (no children), print the text content
	if len(n.Children) == 0 {
		txt := n.Text(source)
		if len(txt) > 30 {
			txt = txt[:27] + "..."
		}
		txt = strings.ReplaceAll(txt, "\n", "\\n")
		fmt.Fprintf(sb, " %q", txt)
	}
	sb.WriteString("\n")

	for _, child := range n.Children {
		child.printRecursive(sb, source, depth+1)
	}
}

// FirstChild returns the first child or nil
func (n *Node) FirstChild() *Node {
	if len(n.Children) > 0 {
		return n.Children[0]
	}
	return nil
}

// NextSibling finds the next sibling in the parent's generic list
func (n *Node) NextSibling() *Node {
	if n.Parent == nil {
		return nil
	}
	for i, sibling := range n.Parent.Children {
		if sibling == n {
			if i+1 < len(n.Parent.Children) {
				return n.Parent.Children[i+1]
			}
			return nil
		}
	}
	return nil
}

// Ancestor returns the first ancestor of the given kind
func (n *Node) Ancestor(kind syntax.SyntaxKind) *Node {
	curr := n.Parent
	for curr != nil {
		if curr.Kind == kind {
			return curr
		}
		curr = curr.Parent
	}
	return nil
}
