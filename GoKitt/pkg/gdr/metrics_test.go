package gdr

import (
	"testing"
)

func TestGDRMetrics_RecordQuery(t *testing.T) {
	m := NewGDRMetrics()

	// Record a query with no expansion
	m.RecordQuery(0, 0, 10, 10, 10)

	if m.TotalQueries != 1 {
		t.Errorf("Expected TotalQueries=1, got %d", m.TotalQueries)
	}
	if m.Expansion0xCount != 1 {
		t.Errorf("Expected Expansion0xCount=1, got %d", m.Expansion0xCount)
	}
	if m.TotalCandidates != 10 {
		t.Errorf("Expected TotalCandidates=10, got %d", m.TotalCandidates)
	}
}

func TestGDRMetrics_ExpansionTracking(t *testing.T) {
	m := NewGDRMetrics()

	// Record queries with different expansion counts
	m.RecordQuery(0, 0, 10, 10, 10)   // No expansion
	m.RecordQuery(1, 5, 40, 10, 10)   // 1 expansion
	m.RecordQuery(2, 10, 80, 10, 10)  // 2 expansions
	m.RecordQuery(3, 20, 160, 10, 10) // 3 expansions
	m.RecordQuery(4, 30, 320, 10, 10) // 4+ expansions (counts as 3)

	if m.TotalQueries != 5 {
		t.Errorf("Expected TotalQueries=5, got %d", m.TotalQueries)
	}
	if m.Expansion0xCount != 1 {
		t.Errorf("Expected Expansion0xCount=1, got %d", m.Expansion0xCount)
	}
	if m.Expansion1xCount != 1 {
		t.Errorf("Expected Expansion1xCount=1, got %d", m.Expansion1xCount)
	}
	if m.Expansion2xCount != 1 {
		t.Errorf("Expected Expansion2xCount=1, got %d", m.Expansion2xCount)
	}
	if m.Expansion3xCount != 2 { // 3 and 4+ both count as 3
		t.Errorf("Expected Expansion3xCount=2, got %d", m.Expansion3xCount)
	}
}

func TestGDRMetrics_ExpansionHitRate(t *testing.T) {
	m := NewGDRMetrics()

	// No queries
	if rate := m.ExpansionHitRate(); rate != 0 {
		t.Errorf("Expected hit rate=0 for no queries, got %f", rate)
	}

	// 50% expansion rate
	m.RecordQuery(0, 0, 10, 10, 10) // No expansion
	m.RecordQuery(1, 5, 40, 10, 10) // Expanded

	if rate := m.ExpansionHitRate(); rate != 0.5 {
		t.Errorf("Expected hit rate=0.5, got %f", rate)
	}
}

func TestGDRMetrics_VerificationRate(t *testing.T) {
	m := NewGDRMetrics()

	// No candidates
	if rate := m.VerificationRate(); rate != 0 {
		t.Errorf("Expected verification rate=0 for no candidates, got %f", rate)
	}

	// 50% verification rate
	m.RecordQuery(0, 0, 100, 50, 50)

	if rate := m.VerificationRate(); rate != 0.5 {
		t.Errorf("Expected verification rate=0.5, got %f", rate)
	}
}

func TestGDRMetrics_RejectionRate(t *testing.T) {
	m := NewGDRMetrics()

	// No candidates
	if rate := m.RejectionRate(); rate != 0 {
		t.Errorf("Expected rejection rate=0 for no candidates, got %f", rate)
	}

	// 30% rejection rate (30 rejects out of 100 candidates)
	m.RecordQuery(0, 30, 100, 70, 70)

	if rate := m.RejectionRate(); rate != 0.3 {
		t.Errorf("Expected rejection rate=0.3, got %f", rate)
	}
}

func TestGDRMetrics_AvgResultsPerQuery(t *testing.T) {
	m := NewGDRMetrics()

	// No queries
	if avg := m.AvgResultsPerQuery(); avg != 0 {
		t.Errorf("Expected avg=0 for no queries, got %f", avg)
	}

	// Average 7.5 results per query
	m.RecordQuery(0, 0, 10, 10, 10)
	m.RecordQuery(0, 0, 10, 5, 5)

	if avg := m.AvgResultsPerQuery(); avg != 7.5 {
		t.Errorf("Expected avg=7.5, got %f", avg)
	}
}

func TestGDRMetrics_Snapshot(t *testing.T) {
	m := NewGDRMetrics()
	m.RecordQuery(1, 5, 40, 10, 10)

	snap := m.Snapshot()

	if snap.TotalQueries != 1 {
		t.Errorf("Expected snapshot TotalQueries=1, got %d", snap.TotalQueries)
	}
	if snap.Expansion1xCount != 1 {
		t.Errorf("Expected snapshot Expansion1xCount=1, got %d", snap.Expansion1xCount)
	}

	// Modify original and verify snapshot is independent
	m.RecordQuery(0, 0, 10, 10, 10)

	if m.TotalQueries != 2 {
		t.Errorf("Expected original TotalQueries=2, got %d", m.TotalQueries)
	}
	if snap.TotalQueries != 1 {
		t.Errorf("Expected snapshot TotalQueries still=1, got %d", snap.TotalQueries)
	}
}

func TestGDRMetrics_Reset(t *testing.T) {
	m := NewGDRMetrics()
	m.RecordQuery(1, 5, 40, 10, 10)
	m.RecordQuery(2, 10, 80, 10, 10)

	m.Reset()

	if m.TotalQueries != 0 {
		t.Errorf("Expected TotalQueries=0 after reset, got %d", m.TotalQueries)
	}
	if m.Expansion1xCount != 0 {
		t.Errorf("Expected Expansion1xCount=0 after reset, got %d", m.Expansion1xCount)
	}
	if m.PhraseHardRejects != 0 {
		t.Errorf("Expected PhraseHardRejects=0 after reset, got %d", m.PhraseHardRejects)
	}
}

func TestGDRMetrics_Concurrency(t *testing.T) {
	m := NewGDRMetrics()
	done := make(chan bool)

	// Concurrent writes
	for i := 0; i < 100; i++ {
		go func() {
			m.RecordQuery(0, 0, 10, 10, 10)
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}

	if m.TotalQueries != 100 {
		t.Errorf("Expected TotalQueries=100 after concurrent writes, got %d", m.TotalQueries)
	}
}
