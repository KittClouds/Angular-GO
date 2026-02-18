package store

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// CozoDB Parity Persistence Tests (Phase 9)
// =============================================================================

func TestNetworkInstance_CRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create
	net := &NetworkInstance{
		ID:           "net1",
		Name:         "Main Network",
		SchemaID:     "schema1",
		NetworkKind:  "general",
		RootFolderID: "folder1",
		Namespace:    "ns1",
		Tags:         []string{"tag1", "tag2"},
		CreatedAt:    time.Now().Unix(),
		UpdatedAt:    time.Now().Unix(),
	}

	err = s.UpsertNetworkInstance(net)
	require.NoError(t, err)

	// Read
	got, err := s.GetNetworkInstance("net1")
	require.NoError(t, err)
	assert.Equal(t, "Main Network", got.Name)
	assert.Equal(t, []string{"tag1", "tag2"}, got.Tags)

	// List
	list, err := s.ListNetworkInstances()
	require.NoError(t, err)
	assert.Len(t, list, 1)

	// Update
	net.Name = "Updated Network"
	err = s.UpsertNetworkInstance(net)
	require.NoError(t, err)

	got, _ = s.GetNetworkInstance("net1")
	assert.Equal(t, "Updated Network", got.Name)

	// Delete
	err = s.DeleteNetworkInstance("net1")
	require.NoError(t, err)

	got, err = s.GetNetworkInstance("net1")
	assert.NoError(t, err) // Should not error, but return nil
	assert.Nil(t, got)
}

func TestNetworkMembership_CRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create
	mem := &NetworkMembership{
		NetworkID: "net1",
		EntityID:  "ent1",
		X:         100.5,
		Y:         200.5,
		Fixed:     true,
	}
	err = s.UpsertNetworkMembership(mem)
	require.NoError(t, err)

	// Read
	members, err := s.GetNetworkMembers("net1")
	require.NoError(t, err)
	assert.Len(t, members, 1)
	assert.Equal(t, "ent1", members[0].EntityID)
	assert.Equal(t, 100.5, members[0].X)

	// Member for other network should be empty
	members2, err := s.GetNetworkMembers("net2")
	require.NoError(t, err)
	assert.Len(t, members2, 0)
}

func TestNetworkRelationship_CRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create
	rel := &NetworkRelationship{
		NetworkID:      "net1",
		SourceEntityID: "src1",
		TargetEntityID: "tgt1",
		RelationshipID: "rel1",
	}
	err = s.UpsertNetworkRelationship(rel)
	require.NoError(t, err)

	// Read
	rels, err := s.GetNetworkRelationships("net1")
	require.NoError(t, err)
	assert.Len(t, rels, 1)
	assert.Equal(t, "rel1", rels[0].RelationshipID)
}

func TestDiscoveryCandidate_CRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create
	cand := &DiscoveryCandidate{
		Token:     "Elbaph",
		Kind:      0, // Unknown?
		Score:     0.95,
		Status:    0, // New
		LastSeen:  time.Now().Unix(),
		FirstSeen: time.Now().Unix(),
		Count:     1,
	}
	err = s.UpsertDiscoveryCandidate(cand)
	require.NoError(t, err)

	// List
	list, err := s.ListDiscoveryCandidates()
	require.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, "Elbaph", list[0].Token)

	// Update (Increment Count)
	cand.Count++
	err = s.UpsertDiscoveryCandidate(cand)
	require.NoError(t, err)

	list, _ = s.ListDiscoveryCandidates()
	assert.Equal(t, 2, list[0].Count)
}

func TestEntityCard_CRUD(t *testing.T) {
	s, err := NewSQLiteStore()
	require.NoError(t, err)
	defer s.Close()

	// Create
	card := &EntityCard{
		EntityID:     "CHARACTER",
		CardID:       "identity",
		Name:         "Identity Core",
		Color:        "blue",
		Icon:         "user",
		DisplayOrder: 1,
		IsCollapsed:  false,
		CreatedAt:    time.Now().Unix(),
		UpdatedAt:    time.Now().Unix(),
	}
	err = s.UpsertEntityCard(card)
	require.NoError(t, err)

	// Get
	cards, err := s.GetEntityCards("CHARACTER")
	require.NoError(t, err)
	assert.Len(t, cards, 1)
	assert.Equal(t, "Identity Core", cards[0].Name)
}
