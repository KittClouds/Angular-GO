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

// Folder represents a folder in the document hierarchy.
type Folder struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	ParentID        string  `json:"parentId,omitempty"`
	WorldID         string  `json:"worldId"`
	NarrativeID     string  `json:"narrativeId,omitempty"`
	FolderOrder     float64 `json:"folderOrder"`
	EntityKind      string  `json:"entityKind"`
	EntitySubtype   string  `json:"entitySubtype"`
	EntityLabel     string  `json:"entityLabel"`
	Color           string  `json:"color"`
	IsTypedRoot     bool    `json:"isTypedRoot"`
	IsSubtypeRoot   bool    `json:"isSubtypeRoot"`
	Collapsed       bool    `json:"collapsed"`
	OwnerID         string  `json:"ownerId"`
	IsNarrativeRoot bool    `json:"isNarrativeRoot"`
	Attributes      string  `json:"attributes,omitempty"` // JSON blob for worldbuilding data, metadata, etc.
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
}

// =============================================================================
// Observational Memory Types (Phase B)
// =============================================================================

// MemoryType categorizes the kind of observation extracted from conversation.
type MemoryType string

const (
	MemoryTypeFact          MemoryType = "fact"           // Factual statement
	MemoryTypePreference    MemoryType = "preference"     // User preference
	MemoryTypeEntityMention MemoryType = "entity_mention" // Entity referenced
	MemoryTypeRelation      MemoryType = "relation"       // Relationship between entities
)

// Memory represents an extracted fact or observation from conversation.
// Stored independently and linked to threads via MemoryThread junction table.
type Memory struct {
	ID         string     `json:"id"`
	Content    string     `json:"content"`            // The extracted fact/observation
	MemoryType MemoryType `json:"memoryType"`         // Categorization
	Confidence float64    `json:"confidence"`         // Extraction confidence 0-1
	SourceRole string     `json:"sourceRole"`         // "user" or "assistant"
	EntityID   string     `json:"entityId,omitempty"` // Optional link to entities table
	CreatedAt  int64      `json:"createdAt"`
	UpdatedAt  int64      `json:"updatedAt"`
}

// Thread represents an LLM conversation thread.
// Can be scoped to world/narrative for context isolation.
type Thread struct {
	ID          string `json:"id"`
	WorldID     string `json:"worldId,omitempty"`
	NarrativeID string `json:"narrativeId,omitempty"`
	Title       string `json:"title,omitempty"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// ThreadMessage is a single message in a conversation thread.
// Maps to TypeScript ChatMessage interface.
type ThreadMessage struct {
	ID          string `json:"id"`
	ThreadID    string `json:"threadId"`
	Role        string `json:"role"`        // "user", "assistant", "system"
	Content     string `json:"content"`     // Message text (or accumulated streaming text)
	NarrativeID string `json:"narrativeId"` // Scope to narrative (from TypeScript scope)
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt,omitempty"` // For streaming updates
	IsStreaming bool   `json:"isStreaming,omitempty"`
}

// MemoryThread links memories to threads (many-to-many relationship).
type MemoryThread struct {
	MemoryID  string `json:"memoryId"`
	ThreadID  string `json:"threadId"`
	MessageID string `json:"messageId,omitempty"` // Source message reference
	CreatedAt int64  `json:"createdAt"`
}

// =============================================================================
// Observational Memory Types (Phase 8) — Three-agent pipeline
// =============================================================================

// OMRecord holds the current observational memory state for a thread.
// This is the core state for the Observer → Reflector → Actor pipeline.
type OMRecord struct {
	ThreadID       string `json:"threadId"`
	Observations   string `json:"observations"`   // LLM-extracted observations (prose)
	CurrentTask    string `json:"currentTask"`    // What the user is currently doing
	LastObservedAt int64  `json:"lastObservedAt"` // Timestamp cursor — messages before this are "observed"
	ObsTokenCount  int    `json:"obsTokenCount"`  // Cached token count of observations
	GenerationNum  int    `json:"generationNum"`  // Reflection generation counter
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

// OMGeneration records a reflection compression event.
// Tracks the history of observation condensation for debugging and rollback.
type OMGeneration struct {
	ID           string `json:"id"`
	ThreadID     string `json:"threadId"`
	Generation   int    `json:"generation"`
	InputTokens  int    `json:"inputTokens"`  // Pre-compression token count
	OutputTokens int    `json:"outputTokens"` // Post-compression token count
	InputText    string `json:"inputText"`    // Pre-compression observations
	OutputText   string `json:"outputText"`   // Post-compression observations
	CreatedAt    int64  `json:"createdAt"`
}

// OMConfig holds threshold settings for the OM pipeline.
// Configurable via Angular settings UI.
type OMConfig struct {
	ObserveThreshold int  // Token count trigger for observation (default: 1000)
	ReflectThreshold int  // Token count trigger for reflection (default: 4000)
	MaxRetries       int  // Reflection compression retries (default: 2)
	Enabled          bool // Master on/off toggle for OM processing
}

// EpisodeActionType defines the type of action recorded in an episode.
type EpisodeActionType string

const (
	ActionCreatedEntity       EpisodeActionType = "created_entity"
	ActionRenamedEntity       EpisodeActionType = "renamed_entity"
	ActionMergedEntity        EpisodeActionType = "merged_entity"
	ActionDeletedEntity       EpisodeActionType = "deleted_entity"
	ActionCreatedBlock        EpisodeActionType = "created_block"
	ActionEditedBlock         EpisodeActionType = "edited_block"
	ActionDeletedBlock        EpisodeActionType = "deleted_block"
	ActionMovedNote           EpisodeActionType = "moved_note"
	ActionCreatedNote         EpisodeActionType = "created_note"
	ActionDeletedNote         EpisodeActionType = "deleted_note"
	ActionCreatedRelationship EpisodeActionType = "created_relationship"
	ActionDeletedRelationship EpisodeActionType = "deleted_relationship"
)

// EpisodeTargetKind defines the kind of target affected by an episode.
type EpisodeTargetKind string

const (
	TargetEntity       EpisodeTargetKind = "entity"
	TargetBlock        EpisodeTargetKind = "block"
	TargetNote         EpisodeTargetKind = "note"
	TargetFolder       EpisodeTargetKind = "folder"
	TargetRelationship EpisodeTargetKind = "relationship"
)

// Episode represents a temporal action log entry.
// Enables "what did the LLM know at time T?" queries.
type Episode struct {
	ID          string            `json:"id"`
	ScopeID     string            `json:"scopeId"` // Usually worldID or narrativeID
	NoteID      string            `json:"noteId"`
	Timestamp   int64             `json:"ts"`
	ActionType  EpisodeActionType `json:"actionType"`
	TargetID    string            `json:"targetId"`
	TargetKind  EpisodeTargetKind `json:"targetKind"`
	Payload     string            `json:"payload"` // JSON string
	NarrativeID string            `json:"narrativeId,omitempty"`
}

// Block represents a text chunk with vector embedding.
// Complements RAPTOR by providing fine-grained LLM memory access.
type Block struct {
	ID          string    `json:"id"` // block_id
	NoteID      string    `json:"noteId"`
	Ordinal     int       `json:"ord"`
	Text        string    `json:"text"`
	Vec         []float32 `json:"textVec,omitempty"` // 384d vector
	NarrativeID string    `json:"narrativeId,omitempty"`
	CreatedAt   int64     `json:"createdAt"`
}

// =============================================================================
// RLM Workspace Types
// =============================================================================

// ScopeKey identifies the RLM workspace scope.
// All RLM operations are scoped by this triple.
type ScopeKey struct {
	ThreadID    string `json:"thread_id"`
	NarrativeID string `json:"narrative_id"`
	FolderID    string `json:"folder_id"`
}

// ArtifactKind is the type descriptor for workspace artifacts.
type ArtifactKind string

const (
	ArtifactHits        ArtifactKind = "hits"
	ArtifactSpanSet     ArtifactKind = "span_set"
	ArtifactSnippet     ArtifactKind = "snippet"
	ArtifactTable       ArtifactKind = "table"
	ArtifactSummary     ArtifactKind = "summary"
	ArtifactDraftAnswer ArtifactKind = "draft_answer"
)

// WorkspaceArtifact is a scoped ephemeral artifact in the RLM workspace.
type WorkspaceArtifact struct {
	Key         string       `json:"key"`
	ThreadID    string       `json:"thread_id"`
	NarrativeID string       `json:"narrative_id"`
	FolderID    string       `json:"folder_id"`
	Kind        ArtifactKind `json:"kind"`
	Payload     string       `json:"payload"` // JSON blob
	Pinned      bool         `json:"pinned"`
	ProducedBy  string       `json:"produced_by"` // op name that created it
	CreatedAt   int64        `json:"created_at"`
	UpdatedAt   int64        `json:"updated_at"`
}

// PinnedPayload is a lightweight view of a pinned workspace artifact.
// Used for crossing the RLM → OM boundary.
type PinnedPayload struct {
	Key     string
	Payload string
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

	// Folders
	UpsertFolder(folder *Folder) error
	GetFolder(id string) (*Folder, error)
	DeleteFolder(id string) error
	ListFolders(parentID string) ([]*Folder, error)

	// Threads - LLM conversation management
	CreateThread(thread *Thread) error
	GetThread(id string) (*Thread, error)
	DeleteThread(id string) error
	ListThreads(worldID string) ([]*Thread, error)

	// ThreadMessages - Conversation history
	AddMessage(msg *ThreadMessage) error
	GetThreadMessages(threadID string) ([]*ThreadMessage, error)
	GetMessage(id string) (*ThreadMessage, error)
	UpdateMessage(msg *ThreadMessage) error
	AppendMessageContent(messageID string, chunk string) error
	DeleteThreadMessages(threadID string) error

	// Memories - Observational memory storage
	CreateMemory(memory *Memory, threadID, messageID string) error
	GetMemory(id string) (*Memory, error)
	DeleteMemory(id string) error
	GetMemoriesForThread(threadID string) ([]*Memory, error)
	ListMemoriesByType(memoryType MemoryType) ([]*Memory, error)

	// Observational Memory — Three-agent pipeline state (Phase 8)
	UpsertOMRecord(record *OMRecord) error
	GetOMRecord(threadID string) (*OMRecord, error)
	DeleteOMRecord(threadID string) error
	AddOMGeneration(gen *OMGeneration) error
	GetOMGenerations(threadID string) ([]*OMGeneration, error)

	// Episode Log - Temporal action stream
	LogEpisode(episode *Episode) error
	GetEpisodes(scopeID string, limit int) ([]*Episode, error)
	SearchEpisodes(scopeID, query string, limit int) ([]*Episode, error)

	// Blocks - Vector-searchable text chunks
	UpsertBlock(block *Block) error
	GetBlocksForNote(noteID string) ([]*Block, error)
	SearchBlocks(queryVec []float32, limit int, narrativeID string) ([]*Block, error)

	// Export/Import (Database serialization for OPFS sync)
	Export() ([]byte, error)
	Import(data []byte) error

	// RLM Workspace — scoped artifact store
	PutArtifact(art *WorkspaceArtifact) error
	GetArtifact(scope *ScopeKey, key string) (*WorkspaceArtifact, error)
	DeleteArtifact(scope *ScopeKey, key string) error
	ListArtifacts(scope *ScopeKey) ([]*WorkspaceArtifact, error)
	SearchNotes(scope *ScopeKey, query string, limit int) ([]*Note, error)

	// Lifecycle
	Close() error

	// =============================================================================
	// CozoDB Parity: Missing Graph Types
	// =============================================================================

	// Spans & Links
	UpsertSpan(span *Span) error
	GetSpan(id string) (*Span, error)
	ListSpansForNote(noteID string) ([]*Span, error)
	DeleteSpan(id string) error

	UpsertWormhole(wormhole *Wormhole) error
	GetWormhole(id string) (*Wormhole, error)
	ListWormholesForSpan(spanID string) ([]*Wormhole, error)
	DeleteWormhole(id string) error

	UpsertSpanMention(mention *SpanMention) error
	GetSpanMention(id string) (*SpanMention, error)
	ListSpanMentions(spanID string) ([]*SpanMention, error)
	DeleteSpanMention(id string) error

	// Network View
	UpsertNetworkInstance(net *NetworkInstance) error
	GetNetworkInstance(id string) (*NetworkInstance, error)
	ListNetworkInstances() ([]*NetworkInstance, error)
	DeleteNetworkInstance(id string) error
	UpsertNetworkMembership(member *NetworkMembership) error
	GetNetworkMembers(networkID string) ([]*NetworkMembership, error)
	DeleteNetworkMembership(networkID string, entityID string) error
	UpsertNetworkRelationship(rel *NetworkRelationship) error
	GetNetworkRelationships(networkID string) ([]*NetworkRelationship, error)
	DeleteNetworkRelationship(networkID string, relationshipID string) error

	// Discovery & Fact Sheets
	UpsertDiscoveryCandidate(candidate *DiscoveryCandidate) error
	ListDiscoveryCandidates() ([]*DiscoveryCandidate, error)
	UpsertEntityCard(card *EntityCard) error
	GetEntityCards(entityID string) ([]*EntityCard, error)
	UpsertFolderSchema(schema *FolderSchema) error
	GetFolderSchema(id string) (*FolderSchema, error)
}

// =============================================================================
// CozoDB Parity: Missing Graph Models
// =============================================================================

// Span represents a text span annotation (e.g., entity mention, quote).
type Span struct {
	ID          string `json:"id"`
	WorldID     string `json:"worldId"`
	NoteID      string `json:"noteId"`
	NarrativeID string `json:"narrativeId,omitempty"`
	Start       int    `json:"start"`
	End         int    `json:"end"`
	Text        string `json:"text"`
	ContentHash string `json:"contentHash"`
	SpanKind    string `json:"spanKind"`
	Status      string `json:"status"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

// Wormhole represents a link between two spans (hyperlink/relationship).
type Wormhole struct {
	ID            string  `json:"id"`
	SrcSpanID     string  `json:"srcSpanId"`
	DstSpanID     string  `json:"dstSpanId"`
	Mode          string  `json:"mode"` // "link", "transclusion", etc.
	Confidence    float64 `json:"confidence"`
	Rationale     string  `json:"rationale,omitempty"`
	WormholeType  string  `json:"wormholeType,omitempty"`
	Bidirectional bool    `json:"bidirectional"`
	CreatedAt     int64   `json:"createdAt"`
	UpdatedAt     int64   `json:"updatedAt"`
}

// SpanMention links a span to a resolved entity.
type SpanMention struct {
	ID                string  `json:"id"`
	SpanID            string  `json:"spanId"`
	CandidateEntityID string  `json:"candidateEntityId,omitempty"`
	MatchType         string  `json:"matchType"` // "exact", "fuzzy", "neural"
	Confidence        float64 `json:"confidence"`
	EvFrequency       float64 `json:"evFrequency,omitempty"`
	EvCapitalRatio    float64 `json:"evCapitalRatio,omitempty"`
	EvContextScore    float64 `json:"evContextScore,omitempty"`
	EvCooccurrence    float64 `json:"evCooccurrence,omitempty"`
	Status            string  `json:"status"`
	CreatedAt         int64   `json:"createdAt"`
	UpdatedAt         int64   `json:"updatedAt"`
}

// NetworkInstance represents a saved graph view ("mind map").
type NetworkInstance struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	SchemaID          string   `json:"schemaId"`
	NetworkKind       string   `json:"networkKind"`
	NetworkSubtype    string   `json:"networkSubtype,omitempty"`
	RootFolderID      string   `json:"rootFolderId"`
	RootEntityID      string   `json:"rootEntityId,omitempty"`
	Namespace         string   `json:"namespace"`
	Description       string   `json:"description,omitempty"`
	Tags              []string `json:"tags"`
	MemberCount       int      `json:"memberCount"`
	RelationshipCount int      `json:"relationshipCount"`
	MaxDepth          int      `json:"maxDepth"`
	CreatedAt         int64    `json:"createdAt"`
	UpdatedAt         int64    `json:"updatedAt"`
	GroupID           string   `json:"groupId,omitempty"`
	ScopeType         string   `json:"scopeType"`
	NarrativeID       string   `json:"narrativeId,omitempty"`
}

// NetworkMembership positions an entity within a network view.
// Composite Key: (NetworkID, EntityID)
type NetworkMembership struct {
	NetworkID string  `json:"networkId"`
	EntityID  string  `json:"entityId"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Fixed     bool    `json:"fixed"`
}

// NetworkRelationship represents an edge visibility in a network view.
// Composite Key: (NetworkID, RelationshipID)
type NetworkRelationship struct {
	NetworkID      string `json:"networkId"`
	SourceEntityID string `json:"sourceEntityId"`
	TargetEntityID string `json:"targetEntityId"`
	RelationshipID string `json:"relationshipId"`
}

// DiscoveryCandidate represents a potential entity found by unsupervised scanning.
type DiscoveryCandidate struct {
	Token     string  `json:"token"`
	Kind      int     `json:"kind"`
	Score     float64 `json:"score"`
	Status    int     `json:"status"` // 0=new, 1=approved, 2=rejected
	LastSeen  int64   `json:"lastSeen"`
	FirstSeen int64   `json:"firstSeen"`
	Count     int     `json:"count"`
}

// EntityCard represents a UI card configuration for an entity fact sheet.
type EntityCard struct {
	EntityID     string `json:"entityId"`
	CardID       string `json:"cardId"`
	Name         string `json:"name"`
	Color        string `json:"color"`
	Icon         string `json:"icon"`
	DisplayOrder int    `json:"displayOrder"`
	IsCollapsed  bool   `json:"isCollapsed"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// FolderSchema defines the allowed structure for a folder type.
type FolderSchema struct {
	ID                      string `json:"id"`
	EntityKind              string `json:"entityKind"`
	Subtype                 string `json:"subtype,omitempty"`
	Name                    string `json:"name"`
	Description             string `json:"description,omitempty"`
	AllowedSubfolders       string `json:"allowedSubfolders"` // JSON array
	AllowedNoteTypes        string `json:"allowedNoteTypes"`  // JSON array
	IsVaultRoot             bool   `json:"isVaultRoot"`
	ContainerOnly           bool   `json:"containerOnly"`
	PropagateKindToChildren bool   `json:"propagateKindToChildren"`
	Icon                    string `json:"icon,omitempty"`
	IsSystem                bool   `json:"isSystem"`
	CreatedAt               int64  `json:"createdAt"`
	UpdatedAt               int64  `json:"updatedAt"`
}
