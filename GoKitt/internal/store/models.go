// Package store provides SQLite-backed persistence for GoKitt WASM.
// This is the unified data layer replacing Dexie/Nebula in TypeScript.
package store

// Note represents a versioned document in the store.
// Uses temporal table pattern for full version history.
type Note struct {
	ID              string  `json:"id"`
	Version         int     `json:"version"`
	WorldID         string  `json:"worldId"`
	Title           string  `json:"title"`
	Content         string  `json:"content"`
	MarkdownContent string  `json:"markdownContent"`
	FolderID        string  `json:"folderId"`
	EntityKind      string  `json:"entityKind"`
	EntitySubtype   string  `json:"entitySubtype"`
	IsEntity        bool    `json:"isEntity"`
	IsPinned        bool    `json:"isPinned"`
	Favorite        bool    `json:"favorite"`
	OwnerID         string  `json:"ownerId"`
	NarrativeID     string  `json:"narrativeId"`
	Order           float64 `json:"order"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`

	// Temporal fields for version tracking
	ValidFrom    int64  `json:"validFrom"`
	ValidTo      *int64 `json:"validTo,omitempty"`
	IsCurrent    bool   `json:"isCurrent"`
	ChangeReason string `json:"changeReason,omitempty"`
}

// Entity represents a registered entity in the store.
// Maps 1:1 to Dexie Entity interface.
type Entity struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Kind          string   `json:"kind"`
	Subtype       string   `json:"subtype,omitempty"`
	Aliases       []string `json:"aliases"`
	FirstNote     string   `json:"firstNote"`
	TotalMentions int      `json:"totalMentions"`
	NarrativeID   string   `json:"narrativeId,omitempty"`
	CreatedBy     string   `json:"createdBy"` // "user" | "extraction" | "auto"
	CreatedAt     int64    `json:"createdAt"`
	UpdatedAt     int64    `json:"updatedAt"`
}

// Edge represents a relationship between two entities.
// Maps 1:1 to Dexie Edge interface.
type Edge struct {
	ID            string  `json:"id"`
	SourceID      string  `json:"sourceId"`
	TargetID      string  `json:"targetId"`
	RelType       string  `json:"relType"`
	Confidence    float64 `json:"confidence"`
	Bidirectional bool    `json:"bidirectional"`
	SourceNote    string  `json:"sourceNote,omitempty"`
	CreatedAt     int64   `json:"createdAt"`
}

// Storer defines the interface for data persistence.
// SQLiteStore is the sole implementation, using in-memory SQLite for WASM.
type Storer interface {
	// Notes - Basic CRUD
	UpsertNote(note *Note) error
	GetNote(id string) (*Note, error)
	DeleteNote(id string) error
	ListNotes(folderID string) ([]*Note, error)
	CountNotes() (int, error)

	// Notes - Version-aware operations
	CreateNote(note *Note) error
	UpdateNote(note *Note, reason string) error
	GetNoteVersion(id string, version int) (*Note, error)
	ListNoteVersions(id string) ([]*Note, error)
	GetNoteAtTime(id string, timestamp int64) (*Note, error)
	RestoreNoteVersion(id string, version int) error

	// Entities
	UpsertEntity(entity *Entity) error
	GetEntity(id string) (*Entity, error)
	GetEntityByLabel(label string) (*Entity, error)
	DeleteEntity(id string) error
	ListEntities(kind string) ([]*Entity, error)
	CountEntities() (int, error)

	// Edges
	UpsertEdge(edge *Edge) error
	GetEdge(id string) (*Edge, error)
	DeleteEdge(id string) error
	ListEdgesForEntity(entityID string) ([]*Edge, error)
	CountEdges() (int, error)

	// Lifecycle
	Close() error
}
