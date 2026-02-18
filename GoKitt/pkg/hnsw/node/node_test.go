// Package node provides the HNSW node structure
package node

import (
	"math"
	"testing"
)

// ============================================================================
// NewNode Contract Tests
// ============================================================================

func TestNewNode_Basic(t *testing.T) {
	n := NewNode(42, 3, []float32{1, 2, 3}, 4)

	if n.ID != 42 {
		t.Errorf("ID = %v, want 42", n.ID)
	}
	if n.Level != 3 {
		t.Errorf("Level = %v, want 3", n.Level)
	}
	if len(n.Vector) != 3 {
		t.Errorf("Vector length = %v, want 3", len(n.Vector))
	}
	if len(n.Neighbors) != 4 {
		t.Errorf("Neighbors layers = %v, want 4", len(n.Neighbors))
	}
	if n.Deleted {
		t.Error("Deleted should be false")
	}
}

func TestNewNode_EmptyVector(t *testing.T) {
	n := NewNode(1, 0, []float32{}, 1)

	if len(n.Vector) != 0 {
		t.Errorf("Empty vector should have length 0, got %v", len(n.Vector))
	}
}

func TestNewNode_LargeVector(t *testing.T) {
	// 1536D vector (OpenAI embedding dimension)
	v := make([]float32, 1536)
	for i := range v {
		v[i] = float32(i)
	}

	n := NewNode(1, 2, v, 3)

	if len(n.Vector) != 1536 {
		t.Errorf("Vector length = %v, want 1536", len(n.Vector))
	}
}

// ============================================================================
// GetMagnitude Contract Tests
// ============================================================================

func TestGetMagnitude_Basic(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	mag := n.GetMagnitude()
	if math.Abs(float64(mag)-5.0) > 1e-6 {
		t.Errorf("GetMagnitude() = %v, want 5.0", mag)
	}
}

func TestGetMagnitude_Cached(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	// First call computes
	mag1 := n.GetMagnitude()
	// Second call uses cache
	mag2 := n.GetMagnitude()

	if mag1 != mag2 {
		t.Errorf("Cached magnitude should be same: %v vs %v", mag1, mag2)
	}
	if !n.magCached {
		t.Error("magCached should be true after GetMagnitude")
	}
}

func TestGetMagnitude_ZeroVector(t *testing.T) {
	n := NewNode(1, 0, []float32{0, 0, 0}, 1)

	mag := n.GetMagnitude()
	if mag != 0 {
		t.Errorf("Zero vector magnitude = %v, want 0", mag)
	}
}

func TestGetMagnitude_768D(t *testing.T) {
	// 768D vector with all ones
	v := make([]float32, 768)
	for i := range v {
		v[i] = 1.0
	}
	n := NewNode(1, 0, v, 1)

	expected := float32(math.Sqrt(768.0))
	mag := n.GetMagnitude()
	if math.Abs(float64(mag)-float64(expected)) > 0.01 {
		t.Errorf("GetMagnitude(768D) = %v, want ~%v", mag, expected)
	}
}

// ============================================================================
// GetNormalized Contract Tests
// ============================================================================

func TestGetNormalized_Basic(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	norm := n.GetNormalized()
	if norm == nil {
		t.Fatal("GetNormalized() returned nil")
	}

	// 3/5 = 0.6, 4/5 = 0.8
	if math.Abs(float64(norm[0])-0.6) > 1e-6 {
		t.Errorf("norm[0] = %v, want 0.6", norm[0])
	}
	if math.Abs(float64(norm[1])-0.8) > 1e-6 {
		t.Errorf("norm[1] = %v, want 0.8", norm[1])
	}
}

func TestGetNormalized_UnitLength(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	norm := n.GetNormalized()

	// Normalized vector should have magnitude 1
	mag := float32(0)
	for _, v := range norm {
		mag += v * v
	}
	mag = float32(math.Sqrt(float64(mag)))

	if math.Abs(float64(mag)-1.0) > 1e-6 {
		t.Errorf("Normalized vector magnitude = %v, want 1.0", mag)
	}
}

func TestGetNormalized_ZeroVector(t *testing.T) {
	n := NewNode(1, 0, []float32{0, 0, 0}, 1)

	norm := n.GetNormalized()
	if norm != nil {
		t.Errorf("Zero vector normalized = %v, want nil", norm)
	}
}

func TestGetNormalized_Cached(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	// First call computes
	norm1 := n.GetNormalized()
	// Second call uses cache
	norm2 := n.GetNormalized()

	// Should be equal values
	if len(norm1) != len(norm2) {
		t.Error("Cached normalized should have same length")
	}
	for i := range norm1 {
		if norm1[i] != norm2[i] {
			t.Errorf("norm1[%d] = %v, norm2[%d] = %v", i, norm1[i], i, norm2[i])
		}
	}

	// But should be different slices (copy returned)
	norm1[0] = 999
	if norm2[0] == float32(999) {
		t.Error("GetNormalized should return a copy, not the cached slice")
	}
}

// ============================================================================
// AddNeighbor Contract Tests
// ============================================================================

func TestAddNeighbor_Basic(t *testing.T) {
	n := NewNode(1, 2, []float32{1}, 3)

	n.AddNeighbor(0, 42)
	n.AddNeighbor(1, 100)

	if len(n.Neighbors[0]) != 1 || n.Neighbors[0][0] != 42 {
		t.Errorf("Neighbors[0] = %v, want [42]", n.Neighbors[0])
	}
	if len(n.Neighbors[1]) != 1 || n.Neighbors[1][0] != 100 {
		t.Errorf("Neighbors[1] = %v, want [100]", n.Neighbors[1])
	}
}

func TestAddNeighbor_Duplicate(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	n.AddNeighbor(0, 42)
	n.AddNeighbor(0, 42) // Duplicate

	if len(n.Neighbors[0]) != 1 {
		t.Errorf("Duplicate neighbor should be ignored, got %v neighbors", len(n.Neighbors[0]))
	}
}

func TestAddNeighbor_InvalidLayer(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	// Layer -1 is invalid
	n.AddNeighbor(-1, 42)
	// Layer 1 is out of bounds
	n.AddNeighbor(1, 42)

	// Should not panic, and layer 0 should be empty
	if len(n.Neighbors[0]) != 0 {
		t.Errorf("Invalid layer add should be ignored, got %v neighbors", len(n.Neighbors[0]))
	}
}

func TestAddNeighbor_Multiple(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	n.AddNeighbor(0, 1)
	n.AddNeighbor(0, 2)
	n.AddNeighbor(0, 3)

	if len(n.Neighbors[0]) != 3 {
		t.Errorf("Should have 3 neighbors, got %v", len(n.Neighbors[0]))
	}
}

// ============================================================================
// GetNeighbors Contract Tests
// ============================================================================

func TestGetNeighbors_Basic(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 2)
	n.AddNeighbor(0, 42)
	n.AddNeighbor(1, 100)

	neighbors0 := n.GetNeighbors(0)
	if len(neighbors0) != 1 || neighbors0[0] != 42 {
		t.Errorf("GetNeighbors(0) = %v, want [42]", neighbors0)
	}

	neighbors1 := n.GetNeighbors(1)
	if len(neighbors1) != 1 || neighbors1[0] != 100 {
		t.Errorf("GetNeighbors(1) = %v, want [100]", neighbors1)
	}
}

func TestGetNeighbors_OutOfBounds(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	neighbors := n.GetNeighbors(5)
	if neighbors != nil {
		t.Errorf("GetNeighbors(5) = %v, want nil", neighbors)
	}
}

// ============================================================================
// NeighborCount Contract Tests
// ============================================================================

func TestNeighborCount_Basic(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)
	n.AddNeighbor(0, 1)
	n.AddNeighbor(0, 2)

	if n.NeighborCount(0) != 2 {
		t.Errorf("NeighborCount(0) = %v, want 2", n.NeighborCount(0))
	}
}

func TestNeighborCount_Empty(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	if n.NeighborCount(0) != 0 {
		t.Errorf("Empty NeighborCount = %v, want 0", n.NeighborCount(0))
	}
}

func TestNeighborCount_OutOfBounds(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	if n.NeighborCount(5) != 0 {
		t.Errorf("OutOfBounds NeighborCount = %v, want 0", n.NeighborCount(5))
	}
}

// ============================================================================
// ClearCache Contract Tests
// ============================================================================

func TestClearCache(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)

	// Compute and cache
	n.GetMagnitude()
	n.GetNormalized()

	if !n.magCached || n.normalized == nil {
		t.Error("Cache should be populated")
	}

	n.ClearCache()

	if n.magCached {
		t.Error("magCached should be false after ClearCache")
	}
	if n.magnitude != 0 {
		t.Error("magnitude should be 0 after ClearCache")
	}
	if n.normalized != nil {
		t.Error("normalized should be nil after ClearCache")
	}
}

// ============================================================================
// Clone Contract Tests
// ============================================================================

func TestClone_Basic(t *testing.T) {
	n := NewNode(42, 3, []float32{1, 2, 3}, 2)
	n.AddNeighbor(0, 10)
	n.AddNeighbor(1, 20)
	n.Deleted = true

	clone := n.Clone()

	if clone.ID != n.ID {
		t.Errorf("Clone ID = %v, want %v", clone.ID, n.ID)
	}
	if clone.Level != n.Level {
		t.Errorf("Clone Level = %v, want %v", clone.Level, n.Level)
	}
	if clone.Deleted != n.Deleted {
		t.Errorf("Clone Deleted = %v, want %v", clone.Deleted, n.Deleted)
	}
}

func TestClone_DeepCopy(t *testing.T) {
	n := NewNode(1, 0, []float32{1, 2, 3}, 1)
	n.AddNeighbor(0, 42)

	clone := n.Clone()

	// Modify original
	n.Vector[0] = 999
	n.Neighbors[0][0] = 100

	// Clone should be unaffected
	if clone.Vector[0] == float32(999) {
		t.Error("Clone should have its own copy of Vector")
	}
	if clone.Neighbors[0][0] == int32(100) {
		t.Error("Clone should have its own copy of Neighbors")
	}
}

func TestClone_CachePreserved(t *testing.T) {
	n := NewNode(1, 0, []float32{3, 4}, 1)
	n.GetMagnitude()
	n.GetNormalized()

	clone := n.Clone()

	// Clone should have cached values
	if !clone.magCached {
		t.Error("Clone should preserve magCached")
	}
	if clone.magnitude != n.magnitude {
		t.Error("Clone should preserve magnitude")
	}
	if clone.normalized == nil {
		t.Error("Clone should preserve normalized")
	}
}

// ============================================================================
// Edge Cases
// ============================================================================

func TestNode_NegativeNeighborID(t *testing.T) {
	// Negative IDs are used as sentinel values in HNSW
	n := NewNode(1, 0, []float32{1}, 1)
	n.AddNeighbor(0, -1)

	if len(n.Neighbors[0]) != 1 || n.Neighbors[0][0] != -1 {
		t.Errorf("Should allow negative neighbor IDs, got %v", n.Neighbors[0])
	}
}

func TestNode_LargeNeighborCount(t *testing.T) {
	n := NewNode(1, 0, []float32{1}, 1)

	// Add many neighbors (M = 16-64 typical)
	for i := int32(0); i < 100; i++ {
		n.AddNeighbor(0, i)
	}

	if n.NeighborCount(0) != 100 {
		t.Errorf("NeighborCount = %v, want 100", n.NeighborCount(0))
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkGetMagnitude_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	n := NewNode(1, 0, v, 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n.ClearCache()
		n.GetMagnitude()
	}
}

func BenchmarkGetNormalized_768D(b *testing.B) {
	v := make([]float32, 768)
	for i := range v {
		v[i] = float32(i)
	}
	n := NewNode(1, 0, v, 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n.ClearCache()
		n.GetNormalized()
	}
}

func BenchmarkAddNeighbor(b *testing.B) {
	n := NewNode(1, 0, []float32{1}, 1)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		n.AddNeighbor(0, int32(i))
	}
}
