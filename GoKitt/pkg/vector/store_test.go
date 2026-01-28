package vector

import (
	"testing"

	"github.com/hack-pad/hackpadfs/mem"
)

func TestStore_RoundTrip(t *testing.T) {
	fs, err := mem.NewFS()
	if err != nil {
		t.Fatal(err)
	}

	// 1. Create and Record
	{
		s, err := NewStore(fs, "index.bin")
		if err != nil {
			t.Fatal(err)
		}

		if err := s.Add(1, []float32{0.1, 0.2, 0.3, 0.0}); err != nil {
			t.Fatal(err)
		}
		if err := s.Add(2, []float32{0.9, 0.8, 0.9, 0.0}); err != nil {
			t.Fatal(err)
		}
		if err := s.Add(3, []float32{0.1, 0.21, 0.31, 0.0}); err != nil {
			t.Fatal(err)
		}

		if err := s.Save(); err != nil {
			t.Fatal(err)
		}
	}

	// 2. Load and Query
	{
		s2, err := NewStore(fs, "index.bin")
		if err != nil {
			t.Fatal(err)
		}

		// Verify stats or size if method existed, but just Search
		results, err := s2.Search([]float32{0.1, 0.2, 0.3, 0.0}, 2)
		if err != nil {
			t.Fatal(err)
		}

		// Expect ID 1 and 3 (closest)
		// Exact match 1 should be first
		if len(results) < 2 {
			t.Fatalf("expected at least 2 results, got %d", len(results))
		}

		if results[0] != 1 {
			t.Errorf("expected top result 1, got %d", results[0])
		}

		// 3 or 2? 3 is closer.
		// dist(1,3) ~ sqrt(0.01^2 + 0.01^2) ~ small
		// dist(1,2) ~ large
		if results[1] != 3 {
			t.Errorf("expected second result 3, got %d", results[1])
		}
	}
}
