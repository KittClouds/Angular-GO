package gldr

import "container/heap"

// ComputeProximity computes proximity scores from anchors via weighted BFS.
// Uses a priority queue to traverse the entity graph with decay per hop.
func (idx *GLDRIndex) ComputeProximity(anchors []EntityAnchor) map[string]float64 {
	if len(anchors) == 0 {
		return nil
	}

	proximity := make(map[string]float64)
	visited := make(map[string]int) // entity_id → best hops

	pq := make(priorityQueue, 0, len(anchors))
	heap.Init(&pq)

	// Initialize with anchors
	for _, a := range anchors {
		heap.Push(&pq, &pqItem{
			entityID: a.EntityID,
			prox:     a.Confidence,
			hops:     0,
		})
		proximity[a.EntityID] = a.Confidence
		visited[a.EntityID] = 0
	}

	// BFS with decay
	for pq.Len() > 0 {
		item := heap.Pop(&pq).(*pqItem)

		// Stop if below threshold
		if item.prox < idx.Config.MinProximity {
			continue
		}

		// Skip if we already have a better path
		if curProx, ok := proximity[item.entityID]; ok && curProx > item.prox {
			continue
		}

		// Expand neighbors
		for _, edge := range idx.GraphAdj[item.entityID] {
			newHops := item.hops + 1
			if newHops > idx.Config.MaxGraphHops {
				continue
			}

			// Compute new proximity
			newProx := item.prox * idx.Config.ProximityDecay * edge.Confidence

			if newProx < idx.Config.MinProximity {
				continue
			}

			// Check if already visited with equal or fewer hops
			if h, ok := visited[edge.TargetID]; ok && h <= newHops {
				continue
			}

			// Update if better
			if curProx, ok := proximity[edge.TargetID]; !ok || newProx > curProx {
				proximity[edge.TargetID] = newProx
				visited[edge.TargetID] = newHops
				heap.Push(&pq, &pqItem{
					entityID: edge.TargetID,
					prox:     newProx,
					hops:     newHops,
				})
			}
		}
	}

	return proximity
}

// --- Priority Queue for BFS ---

type pqItem struct {
	entityID string
	prox     float64
	hops     int
	index    int // heap index
}

type priorityQueue []*pqItem

func (pq priorityQueue) Len() int           { return len(pq) }
func (pq priorityQueue) Less(i, j int) bool { return pq[i].prox > pq[j].prox } // max-heap
func (pq priorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *priorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*pqItem)
	item.index = n
	*pq = append(*pq, item)
}

func (pq *priorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil // GC
	item.index = -1
	*pq = old[:n-1]
	return item
}
