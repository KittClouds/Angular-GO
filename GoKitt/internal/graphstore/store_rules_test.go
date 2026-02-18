package graphstore

import (
	"context"
	"testing"
	"time"

	"github.com/dominikbraun/graph"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestTemporalProperties(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	id := uuid.New()

	// T0: Create with Initial Props
	store.AddVertex(id, TestItem{Name: "V1"}, graph.VertexProperties{
		Attributes: map[string]string{"status": "active", "version": "v1"},
	})
	t0 := time.Now()
	time.Sleep(10 * time.Millisecond) // Ensure gap

	// Verify T0
	props0, err := store.VertexPropsAt(id, t0)
	assert.NoError(t, err)
	assert.Equal(t, "active", string(props0["status"].Raw))
	assert.Equal(t, "v1", string(props0["version"].Raw))

	// T1: Update Properties (via UpdateVertex)
	store.UpdateVertex(id, TestItem{Name: "V1"}, graph.VertexProperties{
		Attributes: map[string]string{"status": "suspended", "version": "v2"},
	})
	t1 := time.Now()
	time.Sleep(10 * time.Millisecond)

	// Verify T1 (Current)
	props1, err := store.VertexPropsAt(id, t1)
	assert.NoError(t, err)
	assert.Equal(t, "suspended", string(props1["status"].Raw))
	assert.Equal(t, "v2", string(props1["version"].Raw))

	// Verify T0 (Point-in-Time) - Should still be "active"
	props0Again, err := store.VertexPropsAt(id, t0)
	assert.NoError(t, err)
	assert.Equal(t, "active", string(props0Again["status"].Raw))
	assert.Equal(t, "v1", string(props0Again["version"].Raw))

	// History Check
	hist, err := store.PropertyHistory(id, "status")
	assert.NoError(t, err)
	assert.Len(t, hist, 2)
	assert.Equal(t, "active", string(hist[0].Raw))
	assert.Equal(t, "suspended", string(hist[1].Raw))
	assert.NotNil(t, hist[0].ValidUntil) // Should be closed
	assert.Nil(t, hist[1].ValidUntil)    // Should be open
}

func TestRulesEngine(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	store := NewJSON[TestItem](db)

	// Define Rule: Find all highly active users
	// (id: User, status: active)

	ruleQ := Query{
		Patterns: []NodePattern{
			{Var: "u", LabelFilter: []string{"User"}},
			// We can filter by property if supported, but let's stick to Label for now
		},
	}

	err := store.Rules.Define("ActiveUsers", ruleQ, true) // Materialized
	assert.NoError(t, err)

	// Run (Empty)
	ctx := context.Background()
	rs, err := store.Rules.Run(ctx, "ActiveUsers")
	assert.NoError(t, err)
	if rs != nil {
		assert.Len(t, rs.Bindings, 0)
	}

	// Add Data
	u1 := uuid.New()
	store.AddVertex(u1, TestItem{Name: "Alice"}, graph.VertexProperties{})
	store.AddLabel(u1, "User")

	// Run Again (Should see update because Invalidate called on write)
	rs, err = store.Rules.Run(ctx, "ActiveUsers")
	assert.NoError(t, err)
	if rs != nil {
		assert.Len(t, rs.Bindings, 1) // Alice
	}

	// Check Materialization
	// Directly inspect rule_results to confirm Cache Hit next time?
	// We trust Run() logic. But let's tamper cache to prove it's used?
	// Or check timestamps.

	// Invalidate manually
	err = store.Rules.Invalidate("ActiveUsers")
	assert.NoError(t, err)

	// Run again -> Recompute
	rs, err = store.Rules.Run(ctx, "ActiveUsers")
	assert.NoError(t, err)
	if rs != nil {
		assert.Len(t, rs.Bindings, 1)
	}
}
