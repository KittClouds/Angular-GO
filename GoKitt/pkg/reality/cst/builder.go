package cst

import "github.com/kittclouds/gokitt/pkg/reality/syntax"

// Builder constructs the CST
type Builder struct {
	stack []*partialNode
	roots []*Node
}

type partialNode struct {
	kind     syntax.SyntaxKind
	start    int
	children []*Node
}

func NewBuilder() *Builder {
	return &Builder{
		stack: make([]*partialNode, 0, 32),
		roots: make([]*Node, 0, 1),
	}
}

// StartNode opens a new internal node
func (b *Builder) StartNode(kind syntax.SyntaxKind, startOffset int) {
	b.stack = append(b.stack, &partialNode{
		kind:     kind,
		start:    startOffset,
		children: make([]*Node, 0, 4),
	})
}

// Token adds a leaf node (no children)
func (b *Builder) Token(kind syntax.SyntaxKind, start, end int) {
	node := &Node{
		Kind:     kind,
		Range:    TextRange{Start: start, End: end},
		Children: nil,
	}
	b.addNode(node)
}

// FinishNode closes the currently open node
func (b *Builder) FinishNode() {
	if len(b.stack) == 0 {
		panic("CST Builder: FinishNode called with empty stack")
	}

	idx := len(b.stack) - 1
	partial := b.stack[idx]
	b.stack = b.stack[:idx]

	endOffset := partial.start
	if len(partial.children) > 0 {
		endOffset = partial.children[len(partial.children)-1].Range.End
	}

	node := &Node{
		Kind:     partial.kind,
		Range:    TextRange{Start: partial.start, End: endOffset},
		Children: partial.children,
	}

	// Back-link children to this new parent
	for _, child := range node.Children {
		child.Parent = node
	}

	b.addNode(node)
}

func (b *Builder) addNode(n *Node) {
	if len(b.stack) > 0 {
		parent := b.stack[len(b.stack)-1]
		parent.children = append(parent.children, n)
	} else {
		b.roots = append(b.roots, n)
	}
}

// Finish returns the constructed tree
func (b *Builder) Finish() *Node {
	if len(b.stack) > 0 {
		panic("CST Builder: Stack not empty at Finish()")
	}
	if len(b.roots) == 0 {
		return nil
	}
	if len(b.roots) == 1 {
		return b.roots[0]
	}

	// Wrap multiple roots
	start := b.roots[0].Range.Start
	end := b.roots[len(b.roots)-1].Range.End

	root := &Node{
		Kind:     syntax.KindRoot,
		Range:    TextRange{Start: start, End: end},
		Children: b.roots,
	}

	for _, child := range root.Children {
		child.Parent = root
	}

	return root
}
