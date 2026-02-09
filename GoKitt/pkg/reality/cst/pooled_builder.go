package cst

import (
	"sync"

	"github.com/kittclouds/gokitt/pkg/reality/syntax"
)

// PooledBuilder constructs CST using pooled nodes to reduce GC pressure
type PooledBuilder struct {
	stack    []*partialPooledNode
	roots    []*Node
	nodePool *NodePool
}

type partialPooledNode struct {
	kind     syntax.SyntaxKind
	start    int
	children []*Node
}

// NodePool wraps sync.Pool for CST nodes
type NodePool struct {
	pool sync.Pool
}

// NewNodePool creates a new node pool
func NewNodePool() *NodePool {
	return &NodePool{
		pool: sync.Pool{
			New: func() interface{} {
				return &Node{
					Children: make([]*Node, 0, 8),
				}
			},
		},
	}
}

// Get retrieves a node from pool
func (p *NodePool) Get() *Node {
	n := p.pool.Get().(*Node)
	n.Kind = 0
	n.Range = TextRange{}
	n.Parent = nil
	n.Children = n.Children[:0]
	return n
}

// Put returns a node to pool
func (p *NodePool) Put(n *Node) {
	if n == nil {
		return
	}
	n.Parent = nil
	for i := range n.Children {
		n.Children[i] = nil
	}
	n.Children = n.Children[:0]
	p.pool.Put(n)
}

// RecycleTree returns an entire tree to pool
func (p *NodePool) RecycleTree(root *Node) {
	if root == nil {
		return
	}
	for _, child := range root.Children {
		p.RecycleTree(child)
	}
	p.Put(root)
}

// Global default pool for convenience
var defaultPool = NewNodePool()

// DefaultPool returns the global node pool
func DefaultPool() *NodePool {
	return defaultPool
}

// NewPooledBuilder creates a builder that uses pooled nodes
func NewPooledBuilder() *PooledBuilder {
	return NewPooledBuilderWithPool(defaultPool)
}

// NewPooledBuilderWithPool creates a builder with a specific pool
func NewPooledBuilderWithPool(pool *NodePool) *PooledBuilder {
	return &PooledBuilder{
		stack:    make([]*partialPooledNode, 0, 32),
		roots:    make([]*Node, 0, 1),
		nodePool: pool,
	}
}

// StartNode opens a new internal node
func (b *PooledBuilder) StartNode(kind syntax.SyntaxKind, startOffset int) {
	b.stack = append(b.stack, &partialPooledNode{
		kind:     kind,
		start:    startOffset,
		children: make([]*Node, 0, 4),
	})
}

// Token adds a leaf node (no children)
func (b *PooledBuilder) Token(kind syntax.SyntaxKind, start, end int) {
	node := b.nodePool.Get()
	node.Kind = kind
	node.Range = TextRange{Start: start, End: end}
	node.Children = nil
	b.addNode(node)
}

// FinishNode closes the currently open node
func (b *PooledBuilder) FinishNode() {
	if len(b.stack) == 0 {
		panic("CST PooledBuilder: FinishNode called with empty stack")
	}

	idx := len(b.stack) - 1
	partial := b.stack[idx]
	b.stack = b.stack[:idx]

	endOffset := partial.start
	if len(partial.children) > 0 {
		endOffset = partial.children[len(partial.children)-1].Range.End
	}

	node := b.nodePool.Get()
	node.Kind = partial.kind
	node.Range = TextRange{Start: partial.start, End: endOffset}
	node.Children = partial.children

	// Back-link children to this new parent
	for _, child := range node.Children {
		child.Parent = node
	}

	b.addNode(node)
}

func (b *PooledBuilder) addNode(n *Node) {
	if len(b.stack) > 0 {
		parent := b.stack[len(b.stack)-1]
		parent.children = append(parent.children, n)
	} else {
		b.roots = append(b.roots, n)
	}
}

// Finish returns the constructed tree
func (b *PooledBuilder) Finish() *Node {
	if len(b.stack) > 0 {
		panic("CST PooledBuilder: Stack not empty at Finish()")
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

	root := b.nodePool.Get()
	root.Kind = syntax.KindRoot
	root.Range = TextRange{Start: start, End: end}
	root.Children = b.roots

	for _, child := range root.Children {
		child.Parent = root
	}

	return root
}
