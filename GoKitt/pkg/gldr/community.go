package gldr

import (
	"math"
	"sort"
)

// DetectCommunities groups entities into communities based on their structured network topology.
// It computes a Personalized PageRank (PPR) vector for each entity, calculates the
// cosine similarity between these vectors to form a similarity matrix, and then
// applies a greedy modularity clustering algorithm to discover factions.
func (idx *GLDRIndex) DetectCommunities() [][]string {
	idx.mu.RLock()
	allUuids, err := idx.Store.ListVertices()
	if err != nil || len(allUuids) == 0 {
		idx.mu.RUnlock()
		return nil
	}

	entities := make([]string, 0, len(allUuids))
	for _, id := range allUuids {
		val, _, err := idx.Store.Vertex(id)
		if err == nil && val != "" {
			entities = append(entities, val)
		}
	}
	idx.mu.RUnlock()

	n := len(entities)
	if n == 0 {
		return nil
	}

	// 1. Compute PPR vectors for each entity
	pprVectors := make([]map[string]float64, n)
	norms := make([]float64, n)

	for i, entity := range entities {
		prox := idx.resolveProximity([]EntityAnchor{{EntityID: entity, Confidence: 1.0, Source: "community"}})
		if prox == nil || len(prox) == 0 {
			prox = map[string]float64{entity: 1.0} // Fallback to self
		}

		var normSq float64
		for _, score := range prox {
			normSq += score * score
		}

		norm := 0.0
		if normSq > 0 {
			norm = math.Sqrt(normSq)
		}

		pprVectors[i] = prox
		norms[i] = norm
	}

	// 2. Build Similarity Matrix (A_ij) via cosine similarity
	// Compute sum of all similarities (2m)
	A := make([][]float64, n)
	for i := 0; i < n; i++ {
		A[i] = make([]float64, n)
	}

	var twoM float64
	for i := 0; i < n; i++ {
		for j := i; j < n; j++ {
			if i == j {
				A[i][j] = 0.0
				continue
			}

			// Dot product
			dot := 0.0
			vI, vJ := pprVectors[i], pprVectors[j]
			if len(vI) > len(vJ) {
				vI, vJ = vJ, vI
			}
			for k, valI := range vI {
				if valJ, ok := vJ[k]; ok {
					dot += valI * valJ
				}
			}

			sim := 0.0
			if norms[i] > 0 && norms[j] > 0 {
				sim = dot / (norms[i] * norms[j])
			}

			// Avoid extremely small values acting as noise
			if sim < 1e-9 {
				sim = 0.0
			}

			A[i][j] = sim
			A[j][i] = sim
			twoM += 2 * sim
		}
	}

	if twoM == 0.0 {
		// No similarities, completely disconnected graph
		result := make([][]string, n)
		for i, entity := range entities {
			result[i] = []string{entity}
		}
		sortCommunities(result)
		return result
	}

	// 3. Greedy Modularity Clustering
	communities := make(map[int][]int) // internal_id -> list of indices
	for i := 0; i < n; i++ {
		communities[i] = []int{i}
	}

	e := make(map[int]map[int]float64)
	a := make(map[int]float64)

	for i := 0; i < n; i++ {
		e[i] = make(map[int]float64)
		sum := 0.0
		for j := 0; j < n; j++ {
			val := A[i][j] / twoM
			if val > 0 {
				e[i][j] = val
				sum += val
			}
		}
		a[i] = sum
	}

	active := make(map[int]bool)
	for i := 0; i < n; i++ {
		active[i] = true
	}

	for {
		var bestI, bestJ int
		var maxDeltaQ float64 = -1.0

		// Find pair maximizing modularity increase
		for i := range active {
			for j, eIj := range e[i] {
				if i >= j || !active[j] {
					continue
				}
				deltaQ := 2 * (eIj - a[i]*a[j])
				if deltaQ > maxDeltaQ {
					maxDeltaQ = deltaQ
					bestI = i
					bestJ = j
				}
			}
		}

		if maxDeltaQ <= 0.0 {
			break // No more improvements
		}

		// Merge bestJ into bestI
		communities[bestI] = append(communities[bestI], communities[bestJ]...)
		delete(communities, bestJ)

		// Update edge fractions logically
		for k := range active {
			if k == bestI || k == bestJ {
				continue
			}

			eIk := e[bestI][k]
			eJk := e[bestJ][k]
			newE := eIk + eJk

			if newE > 0 {
				e[bestI][k] = newE
				e[k][bestI] = newE
			} else {
				delete(e[bestI], k)
				delete(e[k], bestI)
			}

			delete(e[bestJ], k)
			delete(e[k], bestJ)
		}

		e[bestI][bestI] += e[bestJ][bestJ] + 2*e[bestI][bestJ]
		a[bestI] += a[bestJ]

		delete(active, bestJ)
		delete(e, bestJ)
	}

	// 4. Format Output
	result := make([][]string, 0, len(communities))
	for _, comm := range communities {
		group := make([]string, 0, len(comm))
		for _, idx := range comm {
			group = append(group, entities[idx])
		}
		sort.Strings(group)
		result = append(result, group)
	}

	sortCommunities(result)
	return result
}

func sortCommunities(communities [][]string) {
	sort.Slice(communities, func(i, j int) bool {
		if len(communities[i]) != len(communities[j]) {
			return len(communities[i]) > len(communities[j])
		}
		if len(communities[i]) == 0 {
			return false
		}
		return communities[i][0] < communities[j][0]
	})
}
