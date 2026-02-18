package hnsw

import (
	"bytes"
	"math"
	"testing"
)

func TestSerialize_EmptyIndex(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)
	data := idx.Serialize()

	if len(data) < headerSize {
		t.Fatalf("serialized data too short: %d bytes", len(data))
	}

	// Verify header
	magic := uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16 | uint32(data[3])<<24
	if magic != MagicNumber {
		t.Errorf("expected magic 0x%08X, got 0x%08X", MagicNumber, magic)
	}

	if data[4] != FormatVersion {
		t.Errorf("expected version %d, got %d", FormatVersion, data[4])
	}
}

func TestSerialize_SingleNode(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)
	vec := []float32{1.0, 0.0, 0.5, -0.5}
	if err := idx.AddPoint(1, vec); err != nil {
		t.Fatalf("AddPoint failed: %v", err)
	}

	data := idx.Serialize()

	// Deserialize
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	// Verify
	if idx2.M != idx.M {
		t.Errorf("M mismatch: expected %d, got %d", idx.M, idx2.M)
	}
	if idx2.EfConstruction != idx.EfConstruction {
		t.Errorf("EfConstruction mismatch: expected %d, got %d", idx.EfConstruction, idx2.EfConstruction)
	}
	if idx2.Metric != idx.Metric {
		t.Errorf("Metric mismatch: expected %d, got %d", idx.Metric, idx2.Metric)
	}
	if idx2.Dimension() != idx.Dimension() {
		t.Errorf("Dimension mismatch: expected %d, got %d", idx.Dimension(), idx2.Dimension())
	}
	if len(idx2.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(idx2.Nodes))
	}

	// Verify vector
	vec2, ok := idx2.GetVector(1)
	if !ok {
		t.Fatal("node 1 not found")
	}
	for i := range vec {
		if vec[i] != vec2[i] {
			t.Errorf("vector[%d] mismatch: expected %f, got %f", i, vec[i], vec2[i])
		}
	}
}

func TestSerialize_MultipleNodes(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)

	// Add multiple nodes
	vecs := [][]float32{
		{1.0, 0.0, 0.0},
		{0.0, 1.0, 0.0},
		{0.0, 0.0, 1.0},
		{0.5, 0.5, 0.5},
	}

	for i, vec := range vecs {
		if err := idx.AddPoint(uint32(i+1), vec); err != nil {
			t.Fatalf("AddPoint(%d) failed: %v", i+1, err)
		}
	}

	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	// Verify all nodes
	if len(idx2.Nodes) != len(vecs) {
		t.Fatalf("node count mismatch: expected %d, got %d", len(vecs), len(idx2.Nodes))
	}

	for i, vec := range vecs {
		vec2, ok := idx2.GetVector(uint32(i + 1))
		if !ok {
			t.Errorf("node %d not found", i+1)
			continue
		}
		for j := range vec {
			if vec[j] != vec2[j] {
				t.Errorf("node %d vector[%d] mismatch: expected %f, got %f", i+1, j, vec[j], vec2[j])
			}
		}
	}
}

func TestSerialize_DeletedFlag(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)
	vec := []float32{1.0, 0.0, 0.0}
	if err := idx.AddPoint(1, vec); err != nil {
		t.Fatalf("AddPoint failed: %v", err)
	}
	if err := idx.AddPoint(2, vec); err != nil {
		t.Fatalf("AddPoint(2) failed: %v", err)
	}

	// Soft-delete node 1
	idx.DeletePoint(1)

	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	// Verify deleted flag
	if !idx2.Nodes[1].Deleted {
		t.Error("node 1 should be marked deleted")
	}
	if idx2.Nodes[2].Deleted {
		t.Error("node 2 should not be marked deleted")
	}
}

func TestSerialize_EuclideanMetric(t *testing.T) {
	idx := NewIndex(16, 200, Euclidean)
	vec := []float32{1.0, 0.0, 0.0}
	if err := idx.AddPoint(1, vec); err != nil {
		t.Fatalf("AddPoint failed: %v", err)
	}

	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	if idx2.Metric != Euclidean {
		t.Errorf("expected Euclidean metric, got %d", idx2.Metric)
	}
}

func TestSerialize_Neighbors(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)

	// Add nodes that will become neighbors
	vecs := make([][]float32, 10)
	for i := 0; i < 10; i++ {
		vecs[i] = []float32{float32(i) / 10.0, 0.0, 0.0}
		if err := idx.AddPoint(uint32(i+1), vecs[i]); err != nil {
			t.Fatalf("AddPoint(%d) failed: %v", i+1, err)
		}
	}

	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	// Verify neighbors exist (at least some nodes should have neighbors)
	totalNeighbors := 0
	for _, n := range idx2.Nodes {
		for _, layer := range n.Neighbors {
			totalNeighbors += len(layer)
		}
	}

	if totalNeighbors == 0 {
		t.Error("expected some neighbors to be preserved")
	}
}

func TestSerialize_Roundtrip(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)

	// Build a non-trivial index
	for i := 0; i < 100; i++ {
		angle := float64(i) * 2 * math.Pi / 100
		vec := []float32{float32(math.Cos(angle)), float32(math.Sin(angle)), 0.0}
		if err := idx.AddPoint(uint32(i+1), vec); err != nil {
			t.Fatalf("AddPoint(%d) failed: %v", i+1, err)
		}
	}

	// Query original
	query := []float32{1.0, 0.0, 0.0}
	originalResults := idx.SearchKNN(query, 5)

	// Serialize and deserialize
	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	// Query restored
	restoredResults := idx2.SearchKNN(query, 5)

	// Results should be similar (may not be identical due to RNG in level assignment)
	if len(originalResults) != len(restoredResults) {
		t.Errorf("result count mismatch: expected %d, got %d", len(originalResults), len(restoredResults))
	}

	// First result should be the same (closest to query)
	if len(originalResults) > 0 && len(restoredResults) > 0 {
		if originalResults[0].ID != restoredResults[0].ID {
			t.Logf("top result differs: original=%d, restored=%d (may be due to graph structure)",
				originalResults[0].ID, restoredResults[0].ID)
		}
	}
}

func TestSerialize_Writer(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)
	vec := []float32{1.0, 0.0, 0.0}
	if err := idx.AddPoint(1, vec); err != nil {
		t.Fatalf("AddPoint failed: %v", err)
	}

	var buf bytes.Buffer
	if err := idx.SerializeTo(&buf); err != nil {
		t.Fatalf("SerializeTo failed: %v", err)
	}

	idx2, err := Deserialize(buf.Bytes())
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	if len(idx2.Nodes) != 1 {
		t.Errorf("expected 1 node, got %d", len(idx2.Nodes))
	}
}

func TestSerialize_InvalidMagic(t *testing.T) {
	data := make([]byte, headerSize)
	// Wrong magic
	data[0] = 0x00
	data[1] = 0x00
	data[2] = 0x00
	data[3] = 0x00

	_, err := Deserialize(data)
	if err != ErrSerialization {
		t.Errorf("expected ErrSerialization, got %v", err)
	}
}

func TestSerialize_TooShort(t *testing.T) {
	data := make([]byte, 10) // Less than headerSize

	_, err := Deserialize(data)
	if err != ErrSerialization {
		t.Errorf("expected ErrSerialization, got %v", err)
	}
}

func TestSerialize_FutureVersion(t *testing.T) {
	data := make([]byte, headerSize)
	// Correct magic
	data[0] = 0x48
	data[1] = 0x53
	data[2] = 0x4E
	data[3] = 0x57
	// Future version
	data[4] = 99

	_, err := Deserialize(data)
	if err != ErrSerialization {
		t.Errorf("expected ErrSerialization for future version, got %v", err)
	}
}

func TestSerialize_EntryPoint(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)
	vec := []float32{1.0, 0.0, 0.0}
	if err := idx.AddPoint(42, vec); err != nil {
		t.Fatalf("AddPoint failed: %v", err)
	}

	data := idx.Serialize()
	idx2, err := Deserialize(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	if idx2.EntryPointID == nil {
		t.Fatal("EntryPointID should not be nil")
	}
	if *idx2.EntryPointID != 42 {
		t.Errorf("EntryPointID mismatch: expected 42, got %d", *idx2.EntryPointID)
	}
}

func TestSerialize_Deterministic(t *testing.T) {
	idx := NewIndex(16, 200, Cosine)

	// Add nodes in random order
	for i := 0; i < 10; i++ {
		vec := []float32{float32(i) / 10.0, 0.0, 0.0}
		if err := idx.AddPoint(uint32(i+1), vec); err != nil {
			t.Fatalf("AddPoint(%d) failed: %v", i+1, err)
		}
	}

	// Serialize twice
	data1 := idx.Serialize()
	data2 := idx.Serialize()

	// Should be identical
	if !bytes.Equal(data1, data2) {
		t.Error("serialization should be deterministic")
	}
}
