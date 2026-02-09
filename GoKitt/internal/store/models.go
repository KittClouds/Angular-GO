// Package store provides SQLite-backed persistence for GoKitt WASM.
// This is the unified data layer replacing Dexie/Nebula in TypeScript.
package store

// Note represents a document in the store.
// Maps 1:1 to Dexie Note interface.
type Note struct {
	ID              string  `json:"id"`
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
