package pcst

import (
	"container/heap"
	"math"
	"sort"

	"github.com/kittclouds/gokitt/pkg/graph"
)

// Cost type alias
type Cost = float64

// Solution represents the PCST result
type Solution struct {
	Nodes     []string // IDs of nodes in solution
	Edges     []Edge   // Selected edges
	TotalCost Cost     // Total cost (edges + excluded penalties)
}

type Edge struct {
	SourceID string
	TargetID string
}

// Config for IPCST
type Config struct {
	Beta     float64
	MaxDepth int
}

func DefaultConfig() Config {
	return Config{
		Beta:     2.0,
		MaxDepth: 10,
	}
}

// Internal structures used for the algorithm
type pcstInstance struct {
	nodeCount int
	edges     []internalEdge
	penalties []Cost
	root      int // -1 if no root

	// Mapping
	idToIndex map[string]int
	indexToID []string
}

type internalEdge struct {
	u, v    int
	cost    Cost
	origIdx int // index in the original edge list if we needed to track it, but here we just need u,v
}

// IpcstSolver implements the Iterative Prize-Collecting Steiner Tree algorithm
type IpcstSolver struct {
	config Config
	gw     *gwSolver
}

func NewIpcstSolver(cfg Config) *IpcstSolver {
	return &IpcstSolver{
		config: cfg,
		gw:     &gwSolver{epsilon: 1e-10},
	}
}

func (s *IpcstSolver) Solve(g *graph.ConceptGraph, prizes map[string]float64, rootID string) (*Solution, error) {
	// Build internal instance
	inst := s.buildInstance(g, prizes, rootID)

	// Run recursive solver
	sol := s.solveRecursive(inst, 0)

	// Convert back to external solution
	return s.convertSolution(inst, sol), nil
}

func (s *IpcstSolver) solveRecursive(inst *pcstInstance, depth int) *pcsfSolution {
	if depth >= s.config.MaxDepth {
		return s.gw.solve(inst).solution
	}

	// 1. Scaled instance
	instBeta := inst.withScaledPenalties(s.config.Beta)

	// 2. Run GW
	gwRes := s.gw.solve(instBeta)
	tGW := gwRes.solution
	kDead := gwRes.deadNodes

	// 3. Calc real cost of GW solution
	costGW := s.calculateCost(inst, tGW)
	tGW.cost = costGW // update with real cost

	// 4. Live vertices
	live := make(map[int]bool)
	for i := 0; i < inst.nodeCount; i++ {
		if !kDead[i] {
			live[i] = true
		}
	}

	// 5. Steiner Tree on Live
	tST := runMstSteiner(inst, live)
	costST := s.calculateCost(inst, tST)
	tST.cost = costST

	// 6. If K is empty
	if len(kDead) == 0 {
		if costGW <= costST {
			return tGW
		}
		return tST
	}

	// 7. Recurse with zeroed penalties
	instR := inst.withZeroedPenalties(kDead)
	tIT := s.solveRecursive(instR, depth+1)
	costIT := s.calculateCost(inst, tIT)
	tIT.cost = costIT

	// 8. Return min
	best := tGW
	minCost := costGW

	if costST < minCost {
		best = tST
		minCost = costST
	}
	if costIT < minCost {
		best = tIT
		minCost = costIT
	}

	return best
}

func (s *IpcstSolver) calculateCost(inst *pcstInstance, sol *pcsfSolution) Cost {
	edgeCost := 0.0
	// For each edge in solution, find cost in instance
	// This is a bit inefficient (O(M)), but fine for now.
	// We can optimize by storing edge costs in solution or map.
	// Since expected edge count in solution is small:

	// Build adjacency of instance for fast lookup? Or just iterate edges if we kept indices?
	// Let's rely on internalEdge having cost.
	// But sol.edges only has u,v.
	// We need to look up the cost.

	// Optimization: create map for instance edges
	edgeMap := make(map[[2]int]Cost)
	for _, e := range inst.edges {
		u, v := e.u, e.v
		if u > v {
			u, v = v, u
		}
		// Use min cost if multigraph (shouldn't be for this use case but safe)
		if c, ok := edgeMap[[2]int{u, v}]; ok {
			if e.cost < c {
				edgeMap[[2]int{u, v}] = e.cost
			}
		} else {
			edgeMap[[2]int{u, v}] = e.cost
		}
	}

	for _, e := range sol.edges {
		u, v := e.u, e.v
		if u > v {
			u, v = v, u
		}
		edgeCost += edgeMap[[2]int{u, v}]
	}

	penaltyCost := 0.0
	nodeSet := make(map[int]bool)
	for _, n := range sol.nodes {
		nodeSet[n] = true
	}

	for i := 0; i < inst.nodeCount; i++ {
		if !nodeSet[i] {
			penaltyCost += inst.penalties[i]
		}
	}

	return edgeCost + penaltyCost
}

func (s *IpcstSolver) buildInstance(g *graph.ConceptGraph, prizes map[string]float64, rootID string) *pcstInstance {
	nodes := g.AllNodes()
	count := len(nodes)

	idToIndex := make(map[string]int)
	indexToID := make([]string, count)
	penalties := make([]Cost, count)

	for i, n := range nodes {
		idToIndex[n.ID] = i
		indexToID[i] = n.ID
		if p, ok := prizes[n.ID]; ok {
			penalties[i] = p
		} else {
			penalties[i] = 0.0
		}
	}

	var edges []internalEdge
	allEdges := g.AllEdges()

	// Reduce to simple undirected graph, taking min weight if dupes
	// Map (u,v) -> min_cost
	type pair struct{ u, v int }
	minEdges := make(map[pair]float64)

	for _, e := range allEdges {
		uIdx, okU := idToIndex[e.Source.ID]
		vIdx, okV := idToIndex[e.Target.ID]

		if !okU || !okV || uIdx == vIdx {
			continue
		}

		if uIdx > vIdx {
			uIdx, vIdx = vIdx, uIdx
		}

		p := pair{uIdx, vIdx}
		w := e.Edge.Weight
		// Treat weight as cost.
		// If weight is similarity, we might need 1/weight or similar.
		// But usually for PCST, input is cost.
		// Assuming g.Edge.Weight is cost.

		if curr, ok := minEdges[p]; ok {
			if w < curr {
				minEdges[p] = w
			}
		} else {
			minEdges[p] = w
		}
	}

	for p, w := range minEdges {
		edges = append(edges, internalEdge{u: p.u, v: p.v, cost: w})
	}

	root := -1
	if rootID != "" {
		if idx, ok := idToIndex[rootID]; ok {
			root = idx
		}
	}

	return &pcstInstance{
		nodeCount: count,
		edges:     edges,
		penalties: penalties,
		root:      root,
		idToIndex: idToIndex,
		indexToID: indexToID,
	}
}

func (s *IpcstSolver) convertSolution(inst *pcstInstance, sol *pcsfSolution) *Solution {
	res := &Solution{
		TotalCost: sol.cost,
		Nodes:     make([]string, 0, len(sol.nodes)),
		Edges:     make([]Edge, 0, len(sol.edges)),
	}

	for _, nIdx := range sol.nodes {
		res.Nodes = append(res.Nodes, inst.indexToID[nIdx])
	}

	for _, e := range sol.edges {
		res.Edges = append(res.Edges, Edge{
			SourceID: inst.indexToID[e.u],
			TargetID: inst.indexToID[e.v],
		})
	}

	return res
}

// -----------------------------------------------------------------------------
// Internal Helpers / Structures
// -----------------------------------------------------------------------------

type pcsfSolution struct {
	edges []struct{ u, v int }
	nodes []int
	cost  Cost
}

func (inst *pcstInstance) withScaledPenalties(beta float64) *pcstInstance {
	newPen := make([]float64, len(inst.penalties))
	for i, p := range inst.penalties {
		newPen[i] = p / beta
	}
	return &pcstInstance{
		nodeCount: inst.nodeCount,
		edges:     inst.edges, // shared, immutable
		penalties: newPen,
		root:      inst.root,
		idToIndex: inst.idToIndex,
		indexToID: inst.indexToID,
	}
}

func (inst *pcstInstance) withZeroedPenalties(zeros map[int]bool) *pcstInstance {
	newPen := make([]float64, len(inst.penalties))
	copy(newPen, inst.penalties)
	for idx := range zeros {
		if idx < len(newPen) {
			newPen[idx] = 0.0
		}
	}
	return &pcstInstance{
		nodeCount: inst.nodeCount,
		edges:     inst.edges,
		penalties: newPen,
		root:      inst.root,
		idToIndex: inst.idToIndex,
		indexToID: inst.indexToID,
	}
}

// -----------------------------------------------------------------------------
// GW Solver
// -----------------------------------------------------------------------------

type gwSolver struct {
	epsilon float64
}

type gwResult struct {
	solution  *pcsfSolution
	deadNodes map[int]bool
}

type component struct {
	potential float64
	active    bool
}

type eventType int

const (
	evtEdgeTight eventType = iota
	evtCompDeath
)

type gwEvent struct {
	typ     eventType
	time    float64
	edgeIdx int // for EdgeTight
	compID  int // for CompDeath
	index   int // for heap
}

// Priority Queue for Events
type eventHeap []*gwEvent

func (h eventHeap) Len() int           { return len(h) }
func (h eventHeap) Less(i, j int) bool { return h[i].time < h[j].time } // Min heap
func (h eventHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }

func (h *eventHeap) Push(x interface{}) {
	n := len(*h)
	item := x.(*gwEvent)
	item.index = n
	*h = append(*h, item)
}

func (h *eventHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.index = -1
	*h = old[0 : n-1]
	return item
}

func (gw *gwSolver) solve(inst *pcstInstance) *gwResult {
	n := inst.nodeCount
	if n == 0 {
		return &gwResult{&pcsfSolution{}, map[int]bool{}}
	}

	uf := newUnionFind(n)
	comps := make([]*component, n)

	for i := 0; i < n; i++ {
		pot := inst.penalties[i]
		if inst.root == i {
			pot = math.Inf(1)
		}
		comps[i] = &component{potential: pot, active: true}
	}

	edgeColoring := make([]float64, len(inst.edges))
	selectedEdges := make([][2]int, 0)
	deadSets := make([]map[int]bool, 0)

	events := &eventHeap{}
	heap.Init(events)

	currentTime := 0.0

	gw.scheduleEvents(inst, edgeColoring, uf, comps, currentTime, events)

	activeCount := n

	for activeCount > 0 && events.Len() > 0 {
		event := heap.Pop(events).(*gwEvent)
		if event.time < currentTime-gw.epsilon {
			continue // Stale
		}

		delta := event.time - currentTime
		if delta > gw.epsilon {
			// Update edge colorings between active components
			for i, e := range inst.edges {
				rootU := uf.find(e.u)
				rootV := uf.find(e.v)
				if rootU != rootV {
					uActive := comps[rootU].active
					vActive := comps[rootV].active
					if uActive && vActive {
						edgeColoring[i] += 2.0 * delta
					} else if uActive || vActive {
						edgeColoring[i] += delta
					}
				}
			}
			// Update potentials
			for _, c := range comps {
				if c.active && !math.IsInf(c.potential, 1) {
					c.potential -= delta
				}
			}
		}

		currentTime = event.time

		if event.typ == evtEdgeTight {
			e := inst.edges[event.edgeIdx]
			rootU := uf.find(e.u)
			rootV := uf.find(e.v)

			if rootU == rootV {
				continue
			}

			// Verify tight
			if edgeColoring[event.edgeIdx] < e.cost-gw.epsilon {
				continue
			}

			uf.union(rootU, rootV)
			newRoot := uf.find(rootU)
			other := rootU
			if newRoot == rootU {
				other = rootV
			}

			// Check active status merge
			comps[newRoot].potential += comps[other].potential
			comps[newRoot].active = comps[rootU].active || comps[rootV].active
			comps[other].active = false

			selectedEdges = append(selectedEdges, [2]int{e.u, e.v})

		} else if event.typ == evtCompDeath {
			root := uf.find(event.compID)
			if !comps[root].active {
				continue
			}
			if comps[root].potential <= gw.epsilon {
				comps[root].active = false
				activeCount--

				ds := make(map[int]bool)
				for i := 0; i < n; i++ {
					if uf.find(i) == root {
						ds[i] = true
					}
				}
				deadSets = append(deadSets, ds)
			}
		}

		gw.scheduleEvents(inst, edgeColoring, uf, comps, currentTime, events)
	}

	// Pruning
	finalEdges := prune(selectedEdges, deadSets)

	// Build result
	solEdges := make([]struct{ u, v int }, 0)
	solNodes := make([]int, 0)
	nodeSet := make(map[int]bool)

	for _, e := range finalEdges {
		solEdges = append(solEdges, struct{ u, v int }{e[0], e[1]})
		nodeSet[e[0]] = true
		nodeSet[e[1]] = true
	}

	for n := range nodeSet {
		solNodes = append(solNodes, n)
	}

	// Dead nodes for IPCST
	deadNodes := make(map[int]bool)
	for _, ds := range deadSets {
		for id := range ds {
			deadNodes[id] = true
		}
	}

	return &gwResult{
		solution:  &pcsfSolution{edges: solEdges, nodes: solNodes},
		deadNodes: deadNodes,
	}
}

func (gw *gwSolver) scheduleEvents(inst *pcstInstance, coloring []float64, uf *unionFind, comps []*component, currTime float64, events *eventHeap) {
	// Edge Tight
	for i, e := range inst.edges {
		ru := uf.find(e.u)
		rv := uf.find(e.v)
		if ru != rv {
			au := comps[ru].active
			av := comps[rv].active

			if au || av {
				rem := e.cost - coloring[i]
				rate := 1.0
				if au && av {
					rate = 2.0
				}

				if rem > gw.epsilon {
					t := currTime + rem/rate
					heap.Push(events, &gwEvent{typ: evtEdgeTight, time: t, edgeIdx: i})
				}
			}
		}
	}

	// Component Death
	for i := 0; i < inst.nodeCount; i++ {
		root := uf.find(i)
		if i == root && comps[root].active && !math.IsInf(comps[root].potential, 1) {
			t := currTime + comps[root].potential
			heap.Push(events, &gwEvent{typ: evtCompDeath, time: t, compID: i})
		}
	}
}

func prune(edges [][2]int, deadSets []map[int]bool) [][2]int {
	// Need to remove dead sets that have exactly 1 connection to rest
	// Iterative pruning

	currentEdges := make(map[[2]int]bool)
	for _, e := range edges {
		u, v := e[0], e[1]
		if u > v {
			u, v = v, u
		}
		currentEdges[[2]int{u, v}] = true
	}

	changed := true
	for changed {
		changed = false
		for _, ds := range deadSets {
			// Count crossing edges
			var crossing [][2]int
			for e := range currentEdges {
				inU := ds[e[0]]
				inV := ds[e[1]]
				if inU != inV {
					crossing = append(crossing, e)
				}
			}

			if len(crossing) == 1 {
				// Cut it
				delete(currentEdges, crossing[0])
				// Also remove internal edges of this dead set (to be perfectly correct for forest)
				// though usually just cutting the stem is enough to disconnect it
				// let's iterate and remove internals
				for e := range currentEdges {
					if ds[e[0]] && ds[e[1]] {
						delete(currentEdges, e)
					}
				}
				changed = true
			}
		}
	}

	res := make([][2]int, 0, len(currentEdges))
	for e := range currentEdges {
		res = append(res, e)
	}
	return res
}

// -----------------------------------------------------------------------------
// Union Find
// -----------------------------------------------------------------------------

type unionFind struct {
	parent []int
	rank   []int
}

func newUnionFind(n int) *unionFind {
	p := make([]int, n)
	r := make([]int, n)
	for i := 0; i < n; i++ {
		p[i] = i
	}
	return &unionFind{parent: p, rank: r}
}

func (uf *unionFind) find(x int) int {
	if uf.parent[x] != x {
		uf.parent[x] = uf.find(uf.parent[x])
	}
	return uf.parent[x]
}

func (uf *unionFind) union(x, y int) {
	rootX := uf.find(x)
	rootY := uf.find(y)
	if rootX != rootY {
		if uf.rank[rootX] < uf.rank[rootY] {
			uf.parent[rootX] = rootY
		} else if uf.rank[rootX] > uf.rank[rootY] {
			uf.parent[rootY] = rootX
		} else {
			uf.parent[rootY] = rootX
			uf.rank[rootX]++
		}
	}
}

// -----------------------------------------------------------------------------
// MST Steiner
// -----------------------------------------------------------------------------

func runMstSteiner(inst *pcstInstance, terminals map[int]bool) *pcsfSolution {
	if len(terminals) == 0 {
		return &pcsfSolution{}
	}

	// Add root to terminals if exists
	termList := make([]int, 0, len(terminals)+1)
	for t := range terminals {
		termList = append(termList, t)
	}
	if inst.root != -1 && !terminals[inst.root] {
		termList = append(termList, inst.root)
	}

	if len(termList) == 1 {
		return &pcsfSolution{
			nodes: []int{termList[0]},
			edges: nil,
			cost:  0.0, // Edges cost 0. Penalties calculated later.
		}
	}

	// Graph adj
	adj := make([][]struct {
		to   int
		cost float64
	}, inst.nodeCount)
	for _, e := range inst.edges {
		adj[e.u] = append(adj[e.u], struct {
			to   int
			cost float64
		}{e.v, e.cost})
		adj[e.v] = append(adj[e.v], struct {
			to   int
			cost float64
		}{e.u, e.cost})
	}

	// All-pairs shortest paths between terminals
	// dists: (u,v) -> cost
	type pair struct{ u, v int }
	pairDists := make(map[pair]float64)
	pairPaths := make(map[pair][]int) // u -> ... -> v

	for i, start := range termList {
		d, p := dijkstra(inst.nodeCount, adj, start)
		for j := i + 1; j < len(termList); j++ {
			end := termList[j]
			if dist, reachable := d[end]; reachable {
				u, v := start, end
				if u > v {
					u, v = v, u
				}
				pairDists[pair{u, v}] = dist

				// Reconstruct path
				var path []int
				curr := end
				for curr != start {
					path = append(path, curr)
					curr = p[curr]
				}
				path = append(path, start)
				// Reverse to be start->end
				for k, l := 0, len(path)-1; k < l; k, l = k+1, l-1 {
					path[k], path[l] = path[l], path[k]
				}
				pairPaths[pair{u, v}] = path
			}
		}
	}

	// MST on metric closure
	type metaEdge struct {
		u, v int
		cost float64
		path []int
	}
	var metaEdges []metaEdge
	for p, cost := range pairDists {
		metaEdges = append(metaEdges, metaEdge{u: p.u, v: p.v, cost: cost, path: pairPaths[p]})
	}

	sort.Slice(metaEdges, func(i, j int) bool {
		return metaEdges[i].cost < metaEdges[j].cost
	})

	uf := newUnionFind(inst.nodeCount)
	selectedPaths := make([][]int, 0)

	// NOTE: Terminals in metric closure are "dense", but we use UnionFind on original nodes (carefully)
	// Actually standard UnionFind on termList indices is safer? No, node IDs are consistent.

	for _, me := range metaEdges {
		if uf.find(me.u) != uf.find(me.v) {
			uf.union(me.u, me.v)
			selectedPaths = append(selectedPaths, me.path)
		}
	}

	// Collect solution
	solEdges := make(map[[2]int]bool)
	solNodes := make(map[int]bool)

	for _, path := range selectedPaths {
		if len(path) < 2 {
			continue
		}
		for i := 0; i < len(path)-1; i++ {
			u, v := path[i], path[i+1]
			solNodes[u] = true
			solNodes[v] = true
			if u > v {
				u, v = v, u
			}
			solEdges[[2]int{u, v}] = true
		}
	}

	finalEdges := make([]struct{ u, v int }, 0, len(solEdges))
	for e := range solEdges {
		finalEdges = append(finalEdges, struct{ u, v int }{e[0], e[1]})
	}
	finalNodes := make([]int, 0, len(solNodes))
	for n := range solNodes {
		finalNodes = append(finalNodes, n)
	}

	return &pcsfSolution{
		edges: finalEdges,
		nodes: finalNodes,
	}
}

func dijkstra(n int, adj [][]struct {
	to   int
	cost float64
}, start int) (map[int]float64, map[int]int) {
	dist := make(map[int]float64)
	parent := make(map[int]int)

	pq := &dijkstraHeap{}
	heap.Init(pq)

	dist[start] = 0.0
	heap.Push(pq, &dijkstraNode{id: start, cost: 0.0})

	for pq.Len() > 0 {
		curr := heap.Pop(pq).(*dijkstraNode)

		if d, ok := dist[curr.id]; ok && d < curr.cost {
			continue
		}

		for _, edge := range adj[curr.id] {
			newCost := curr.cost + edge.cost
			if d, ok := dist[edge.to]; !ok || newCost < d {
				dist[edge.to] = newCost
				parent[edge.to] = curr.id
				heap.Push(pq, &dijkstraNode{id: edge.to, cost: newCost})
			}
		}
	}

	return dist, parent
}

type dijkstraNode struct {
	id    int
	cost  float64
	index int
}

type dijkstraHeap []*dijkstraNode

func (h dijkstraHeap) Len() int           { return len(h) }
func (h dijkstraHeap) Less(i, j int) bool { return h[i].cost < h[j].cost }
func (h dijkstraHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i]; h[i].index = i; h[j].index = j }
func (h *dijkstraHeap) Push(x interface{}) {
	n := len(*h)
	item := x.(*dijkstraNode)
	item.index = n
	*h = append(*h, item)
}
func (h *dijkstraHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.index = -1
	*h = old[0 : n-1]
	return item
}
