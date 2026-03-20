package graptor

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	docchunker "github.com/kittclouds/gokitt/pkg/chunker"
	"github.com/kittclouds/gokitt/pkg/fullsystemindex"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/qgram"
	"github.com/kittclouds/gokitt/pkg/raptor"
	"github.com/kittclouds/gokitt/pkg/scanner/discovery"
)

const (
	ChunkingStrategyChunkerX2              = "chunker_x2"
	ChunkingStrategyChapterParagraphLegacy = "chapter_paragraph_legacy"
	PersistenceModeExplicitCommit          = "explicit_commit"

	SearchTargetQGram      = "qgram"
	SearchTargetGLDRChunks = "gldr_chunks"
	SearchTargetGLDRNodes  = "gldr_nodes"
	SearchTargetRaptor     = "raptor"

	scopedNamespaceSessionManifest = "graptor.session"
	scopedNamespaceChunkManifest   = "graptor.chunk_manifest"
)

var (
	legacyChapterHeaderRegex = regexp.MustCompile(`(?i)^##\s*Chapter\s*(\d+)[:.]?\s*(.*)$`)
	numberedChapterRegex     = regexp.MustCompile(`(?i)\bchapter\s*(\d+)\b`)
)

// EmbeddingProvider is an optional adapter for enabling RAPTOR.
type EmbeddingProvider interface {
	EmbedTexts(texts []string) ([][]float32, error)
}

// FullSystemChunkingConfig controls document-level chunking.
type FullSystemChunkingConfig struct {
	Strategy  string `json:"strategy,omitempty"`
	ChunkSize int    `json:"chunkSize,omitempty"`
	Overlap   int    `json:"overlap,omitempty"`
}

// FullSystemFeatureConfig controls which retrieval/indexing layers are built.
type FullSystemFeatureConfig struct {
	Discovery *bool `json:"discovery,omitempty"`
	Reality   *bool `json:"reality,omitempty"`
	QGram     *bool `json:"qgram,omitempty"`
	GLDR      *bool `json:"gldr,omitempty"`
	Raptor    *bool `json:"raptor,omitempty"`
}

// FullSystemPersistenceConfig controls persistence behavior.
type FullSystemPersistenceConfig struct {
	Mode string `json:"mode,omitempty"`
}

// FullSystemConfig is the public session configuration.
type FullSystemConfig struct {
	Chunking          FullSystemChunkingConfig    `json:"chunking,omitempty"`
	Features          FullSystemFeatureConfig     `json:"features,omitempty"`
	Persistence       FullSystemPersistenceConfig `json:"persistence,omitempty"`
	GLDRConfig        *fullsystemindex.GLDRConfig `json:"gldrConfig,omitempty"`
	RaptorConfig      *raptor.RaptorConfig        `json:"raptorConfig,omitempty"`
	EmbeddingProvider EmbeddingProvider           `json:"-"`
}

// DefaultFullSystemConfig returns the canonical full-system defaults.
func DefaultFullSystemConfig() FullSystemConfig {
	return FullSystemConfig{
		Chunking: FullSystemChunkingConfig{
			Strategy:  ChunkingStrategyChunkerX2,
			ChunkSize: 500,
			Overlap:   100,
		},
		Features: FullSystemFeatureConfig{
			Discovery: boolPtr(true),
			Reality:   boolPtr(true),
			QGram:     boolPtr(true),
			GLDR:      boolPtr(true),
			Raptor:    boolPtr(false),
		},
		Persistence: FullSystemPersistenceConfig{
			Mode: PersistenceModeExplicitCommit,
		},
	}
}

// FullSystemScope scopes indexing and persistence.
type FullSystemScope struct {
	WorldID     string `json:"worldId,omitempty"`
	NarrativeID string `json:"narrativeId,omitempty"`
	FolderID    string `json:"folderId,omitempty"`
	FolderPath  string `json:"folderPath,omitempty"`
}

// IngestDocumentInput is one document fed into the full-system session.
type IngestDocumentInput struct {
	DocumentID string            `json:"documentId,omitempty"`
	Title      string            `json:"title,omitempty"`
	Text       string            `json:"text"`
	NoteID     string            `json:"noteId,omitempty"`
	Scope      *FullSystemScope  `json:"scope,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// SeedEntity is the LLM-friendly seed format for dictionary/bootstrap entities.
type SeedEntity struct {
	ID          string      `json:"id,omitempty"`
	Label       string      `json:"label"`
	Aliases     []string    `json:"aliases,omitempty"`
	Kind        interface{} `json:"kind,omitempty"`
	NarrativeID string      `json:"narrativeId,omitempty"`
}

// IngestRetrievalBuildFlags optionally override retrieval builds for a single ingest call.
type IngestRetrievalBuildFlags struct {
	QGram  *bool `json:"qgram,omitempty"`
	GLDR   *bool `json:"gldr,omitempty"`
	Raptor *bool `json:"raptor,omitempty"`
}

// IngestRequest stages one or more documents into the session.
type IngestRequest struct {
	Documents    []IngestDocumentInput      `json:"documents"`
	SeedEntities []SeedEntity               `json:"seedEntities,omitempty"`
	Scope        *FullSystemScope           `json:"scope,omitempty"`
	Retrieval    *IngestRetrievalBuildFlags `json:"retrieval,omitempty"`
}

// SearchRequest executes retrieval over the staged session state.
type SearchRequest struct {
	Query   string           `json:"query"`
	Limit   int              `json:"limit,omitempty"`
	Targets []string         `json:"targets,omitempty"`
	Scope   *FullSystemScope `json:"scope,omitempty"`
}

// CommitRequest persists staged canonical artifacts to SQLite.
type CommitRequest struct {
	Scope *FullSystemScope `json:"scope,omitempty"`
}

// RunOnceRequest is the convenience wrapper for one-shot usage.
type RunOnceRequest struct {
	Config *FullSystemConfig `json:"config,omitempty"`
	Ingest IngestRequest     `json:"ingest"`
	Search *SearchRequest    `json:"search,omitempty"`
	Commit *CommitRequest    `json:"commit,omitempty"`
}

// FullSystemChunkStats summarizes chunk-tree output.
type FullSystemChunkStats struct {
	Strategy      string `json:"strategy"`
	ChunkSize     int    `json:"chunkSize"`
	Overlap       int    `json:"overlap"`
	Documents     int    `json:"documents"`
	TotalChapters int    `json:"totalChapters"`
	TotalParents  int    `json:"totalParents"`
	TotalLeaves   int    `json:"totalLeaves"`
}

// FullSystemGraphSummary summarizes Graptor/Reality output.
type FullSystemGraphSummary struct {
	Documents         int `json:"documents"`
	TotalChapters     int `json:"totalChapters"`
	TotalLeaves       int `json:"totalLeaves"`
	TotalEntities     int `json:"totalEntities"`
	TotalMentions     int `json:"totalMentions"`
	TotalEdges        int `json:"totalEdges"`
	CrossChapterLinks int `json:"crossChapterLinks"`
}

// FullSystemEntitySummary summarizes entity registry output.
type FullSystemEntitySummary struct {
	TotalEntities        int `json:"totalEntities"`
	TotalAliases         int `json:"totalAliases"`
	TotalMentions        int `json:"totalMentions"`
	MultiChapterEntities int `json:"multiChapterEntities"`
}

// FullSystemDiscoverySummary summarizes discovery output.
type FullSystemDiscoverySummary struct {
	CandidateCount int `json:"candidateCount"`
	PromotedCount  int `json:"promotedCount"`
}

// FullSystemRetrievalSummary summarizes retrieval indexes.
type FullSystemRetrievalSummary struct {
	QGramDocuments  int  `json:"qgramDocuments"`
	GLDRChunks      int  `json:"gldrChunks"`
	GLDREntities    int  `json:"gldrEntities"`
	GLDREdges       int  `json:"gldrEdges"`
	RaptorDocuments int  `json:"raptorDocuments"`
	RaptorLeaves    int  `json:"raptorLeaves"`
	RaptorEnabled   bool `json:"raptorEnabled"`
}

// IngestDocumentResult summarizes one ingested document.
type IngestDocumentResult struct {
	DocumentID            string `json:"documentId"`
	Title                 string `json:"title,omitempty"`
	ChapterCount          int    `json:"chapterCount"`
	ParentCount           int    `json:"parentCount"`
	LeafCount             int    `json:"leafCount"`
	EntityCount           int    `json:"entityCount"`
	EdgeCount             int    `json:"edgeCount"`
	HasFrontMatterChapter bool   `json:"hasFrontMatterChapter"`
}

// IngestResult is the aggregate ingest response.
type IngestResult struct {
	SessionID        string                     `json:"sessionId"`
	ChunkStats       FullSystemChunkStats       `json:"chunkStats"`
	DocumentGraph    FullSystemGraphSummary     `json:"documentGraph"`
	EntitySummary    FullSystemEntitySummary    `json:"entitySummary"`
	DiscoverySummary FullSystemDiscoverySummary `json:"discoverySummary"`
	RetrievalSummary FullSystemRetrievalSummary `json:"retrievalSummary"`
	Documents        []IngestDocumentResult     `json:"documents"`
	Warnings         []string                   `json:"warnings,omitempty"`
}

// QGramSearchHit is the grouped qgram result shape.
type QGramSearchHit struct {
	DocID    string  `json:"docId"`
	Score    float64 `json:"score"`
	Coverage float64 `json:"coverage"`
}

// RaptorSearchHit is the grouped RAPTOR result shape.
type RaptorSearchHit struct {
	DocID    string  `json:"docId"`
	ChunkID  string  `json:"chunkId"`
	Start    int     `json:"start"`
	End      int     `json:"end"`
	Score    float64 `json:"score"`
	LexScore float64 `json:"lexScore"`
	VecScore float32 `json:"vecScore"`
}

// SearchResult groups the supported retrieval outputs.
type SearchResult struct {
	SessionID  string                        `json:"sessionId"`
	Query      string                        `json:"query"`
	Limit      int                           `json:"limit"`
	Targets    []string                      `json:"targets"`
	QGram      []QGramSearchHit              `json:"qgram,omitempty"`
	GLDRChunks []fullsystemindex.ChunkResult `json:"gldrChunks,omitempty"`
	GLDRNodes  []fullsystemindex.NodeResult  `json:"gldrNodes,omitempty"`
	Raptor     []RaptorSearchHit             `json:"raptor,omitempty"`
	Warnings   []string                      `json:"warnings,omitempty"`
}

// CommitResult summarizes canonical persistence writes.
type CommitResult struct {
	SessionID              string   `json:"sessionId"`
	Notes                  int      `json:"notes"`
	Entities               int      `json:"entities"`
	Aliases                int      `json:"aliases"`
	Spans                  int      `json:"spans"`
	Mentions               int      `json:"mentions"`
	Edges                  int      `json:"edges"`
	DiscoveryCandidates    int      `json:"discoveryCandidates"`
	ScopedManifestsWritten int      `json:"scopedManifestsWritten"`
	AlreadyCommitted       bool     `json:"alreadyCommitted"`
	Warnings               []string `json:"warnings,omitempty"`
}

// FullSystemResolvedFeatures is the explicit feature state after defaulting.
type FullSystemResolvedFeatures struct {
	Discovery bool `json:"discovery"`
	Reality   bool `json:"reality"`
	QGram     bool `json:"qgram"`
	GLDR      bool `json:"gldr"`
	Raptor    bool `json:"raptor"`
}

// SessionState describes the current session lifecycle state.
type SessionState struct {
	SessionID        string                     `json:"sessionId"`
	Chunking         FullSystemChunkingConfig   `json:"chunking"`
	Features         FullSystemResolvedFeatures `json:"features"`
	PersistenceMode  string                     `json:"persistenceMode"`
	DocumentCount    int                        `json:"documentCount"`
	Dirty            bool                       `json:"dirty"`
	Committed        bool                       `json:"committed"`
	CommitCount      int                        `json:"commitCount"`
	AvailableTargets []string                   `json:"availableTargets"`
}

// FullSystemPersistenceSummary captures session persistence state.
type FullSystemPersistenceSummary struct {
	Mode        string `json:"mode"`
	Dirty       bool   `json:"dirty"`
	Committed   bool   `json:"committed"`
	CommitCount int    `json:"commitCount"`
	HasStore    bool   `json:"hasStore"`
}

// SessionStats exposes the current aggregate session metrics.
type SessionStats struct {
	SessionID          string                       `json:"sessionId"`
	ChunkStats         FullSystemChunkStats         `json:"chunkStats"`
	DocumentGraph      FullSystemGraphSummary       `json:"documentGraph"`
	EntitySummary      FullSystemEntitySummary      `json:"entitySummary"`
	DiscoverySummary   FullSystemDiscoverySummary   `json:"discoverySummary"`
	RetrievalSummary   FullSystemRetrievalSummary   `json:"retrievalSummary"`
	PersistenceSummary FullSystemPersistenceSummary `json:"persistenceSummary"`
}

// RunOnceResult is the one-shot wrapper response.
type RunOnceResult struct {
	SessionID string        `json:"sessionId"`
	Ingest    *IngestResult `json:"ingest,omitempty"`
	Search    *SearchResult `json:"search,omitempty"`
	Commit    *CommitResult `json:"commit,omitempty"`
	Stats     *SessionStats `json:"stats,omitempty"`
}

type fullSystemResolvedConfig struct {
	Chunking     FullSystemChunkingConfig
	Features     FullSystemResolvedFeatures
	Persistence  FullSystemPersistenceConfig
	GLDRConfig   fullsystemindex.GLDRConfig
	RaptorConfig raptor.RaptorConfig
	Embedder     EmbeddingProvider
}

type fullSystemDocument struct {
	Input                 IngestDocumentInput
	Scope                 FullSystemScope
	NoteID                string
	Strategy              string
	ChapterCount          int
	ParentCount           int
	LeafCount             int
	HasFrontMatterChapter bool
	SearchChunks          []fullSystemChunk
	DocumentGraph         *DocumentGraph
	DiscoveryCandidates   []discovery.Candidate
	Warnings              []string
}

type fullSystemChunk struct {
	SearchID       string
	ChapterID      uint32
	GraptorChunkID uint32
	ParentID       uint32
	Start          int
	End            int
	Text           string
	Mentions       []fullsystemindex.Mention
}

type fullSystemChunkKey struct {
	ChapterID uint32
	ChunkID   uint32
}

type fullSystemChapterSpec struct {
	ChapterID uint32
	Start     int
	End       int
	Title     string
	Text      string
	Leaves    []LeafInput
}

type persistedEntityManifest struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Aliases []string `json:"aliases,omitempty"`
}

type persistedMentionManifest struct {
	EntityID   string  `json:"entityId"`
	Confidence float64 `json:"confidence"`
	Start      int     `json:"start"`
	End        int     `json:"end"`
}

type persistedChunkManifest struct {
	ChunkID        string                     `json:"chunkId"`
	ChapterID      uint32                     `json:"chapterId"`
	GraptorChunkID uint32                     `json:"graptorChunkId"`
	ParentID       uint32                     `json:"parentId"`
	Start          int                        `json:"start"`
	End            int                        `json:"end"`
	Text           string                     `json:"text"`
	Mentions       []persistedMentionManifest `json:"mentions,omitempty"`
}

type persistedGraphEdgeManifest struct {
	SourceID      string  `json:"sourceId"`
	TargetID      string  `json:"targetId"`
	RelType       string  `json:"relType"`
	Confidence    float64 `json:"confidence"`
	Source        string  `json:"source"`
	SourceChapter uint32  `json:"sourceChapter,omitempty"`
	TargetChapter uint32  `json:"targetChapter,omitempty"`
}

type persistedCooccurrenceManifest struct {
	Entity1ID string `json:"entity1Id"`
	Entity2ID string `json:"entity2Id"`
	Count     int    `json:"count"`
}

type persistedDocumentManifest struct {
	SessionID             string                          `json:"sessionId"`
	DocumentID            string                          `json:"documentId"`
	NoteID                string                          `json:"noteId"`
	Title                 string                          `json:"title,omitempty"`
	Scope                 FullSystemScope                 `json:"scope"`
	Strategy              string                          `json:"strategy"`
	ChapterCount          int                             `json:"chapterCount"`
	ParentCount           int                             `json:"parentCount"`
	LeafCount             int                             `json:"leafCount"`
	HasFrontMatterChapter bool                            `json:"hasFrontMatterChapter"`
	Chunks                []persistedChunkManifest        `json:"chunks"`
	Edges                 []persistedGraphEdgeManifest    `json:"edges,omitempty"`
	Cooccurrences         []persistedCooccurrenceManifest `json:"cooccurrences,omitempty"`
}

type persistedSessionManifest struct {
	SessionID   string                    `json:"sessionId"`
	CommittedAt int64                     `json:"committedAt"`
	Documents   []IngestDocumentResult    `json:"documents"`
	Entities    []persistedEntityManifest `json:"entities"`
}

// FullSystemSession owns the canonical staged full-system state.
type FullSystemSession struct {
	mu          sync.RWMutex
	ID          string
	resolved    fullSystemResolvedConfig
	store       *store.SQLiteStore
	qgramIndex  *qgram.QGramIndex
	gldrIndex   *fullsystemindex.Engine
	raptorIndex *raptor.RaptorIndex

	documents    map[string]*fullSystemDocument
	seedEntities []implicitmatcher.RegisteredEntity

	dirty       bool
	committed   bool
	commitCount int
}

// FullSystemManager owns session lifecycle and lookup.
type FullSystemManager struct {
	mu       sync.RWMutex
	sessions map[string]*FullSystemSession
	store    *store.SQLiteStore
}

// NewFullSystemManager creates a session manager with an optional SQLite store.
func NewFullSystemManager(sqlStore *store.SQLiteStore) *FullSystemManager {
	return &FullSystemManager{
		sessions: make(map[string]*FullSystemSession),
		store:    sqlStore,
	}
}

// SetStore updates the manager-wide SQLite store pointer.
func (m *FullSystemManager) SetStore(sqlStore *store.SQLiteStore) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.store = sqlStore
	for _, session := range m.sessions {
		session.setStore(sqlStore)
	}
}

// CreateSession allocates a new full-system session and returns its ID.
func (m *FullSystemManager) CreateSession(config *FullSystemConfig) (string, error) {
	resolved, err := normalizeFullSystemConfig(config)
	if err != nil {
		return "", err
	}

	sessionID := newFullSystemSessionID()
	session := newFullSystemSession(sessionID, resolved, m.store)

	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[sessionID] = session
	return sessionID, nil
}

// IngestDocuments stages one or more documents into the named session.
func (m *FullSystemManager) IngestDocuments(sessionID string, req IngestRequest) (*IngestResult, error) {
	session, err := m.getSession(sessionID)
	if err != nil {
		return nil, err
	}
	return session.IngestDocuments(req)
}

// Search runs grouped retrieval over the named session.
func (m *FullSystemManager) Search(sessionID string, req SearchRequest) (*SearchResult, error) {
	session, err := m.getSession(sessionID)
	if err != nil {
		return nil, err
	}
	return session.Search(req)
}

// Commit persists the named session's canonical artifacts.
func (m *FullSystemManager) Commit(sessionID string, req CommitRequest) (*CommitResult, error) {
	session, err := m.getSession(sessionID)
	if err != nil {
		return nil, err
	}
	return session.Commit(req)
}

// GetState returns the current lifecycle state for the named session.
func (m *FullSystemManager) GetState(sessionID string) (*SessionState, error) {
	session, err := m.getSession(sessionID)
	if err != nil {
		return nil, err
	}
	return session.GetState(), nil
}

// GetStats returns aggregate stats for the named session.
func (m *FullSystemManager) GetStats(sessionID string) (*SessionStats, error) {
	session, err := m.getSession(sessionID)
	if err != nil {
		return nil, err
	}
	return session.GetStats(), nil
}

// LoadCommittedScope rebuilds indexes from persisted manifests in a scope.
func (m *FullSystemManager) LoadCommittedScope(sessionID string, scope FullSystemScope) error {
	session, err := m.getSession(sessionID)
	if err != nil {
		return err
	}
	return session.LoadCommittedScope(scope)
}

// CloseSession disposes the named session.
func (m *FullSystemManager) CloseSession(sessionID string) error {
	m.mu.Lock()
	session, ok := m.sessions[sessionID]
	if ok {
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()

	if !ok {
		return fmt.Errorf("full system session %q not found", sessionID)
	}

	session.Close()
	return nil
}

// RunOnce is the LLM-friendly one-shot session wrapper.
func (m *FullSystemManager) RunOnce(req RunOnceRequest) (*RunOnceResult, error) {
	sessionID, err := m.CreateSession(req.Config)
	if err != nil {
		return nil, err
	}
	defer func() { _ = m.CloseSession(sessionID) }()

	result := &RunOnceResult{SessionID: sessionID}

	ingestResult, err := m.IngestDocuments(sessionID, req.Ingest)
	if err != nil {
		return nil, err
	}
	result.Ingest = ingestResult

	if req.Search != nil {
		searchResult, err := m.Search(sessionID, *req.Search)
		if err != nil {
			return nil, err
		}
		result.Search = searchResult
	}

	if req.Commit != nil {
		commitResult, err := m.Commit(sessionID, *req.Commit)
		if err != nil {
			return nil, err
		}
		result.Commit = commitResult
	}

	stats, err := m.GetStats(sessionID)
	if err != nil {
		return nil, err
	}
	result.Stats = stats

	return result, nil
}

func (m *FullSystemManager) getSession(sessionID string) (*FullSystemSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("full system session %q not found", sessionID)
	}
	return session, nil
}

func newFullSystemSession(id string, resolved fullSystemResolvedConfig, sqlStore *store.SQLiteStore) *FullSystemSession {
	session := &FullSystemSession{
		ID:           id,
		resolved:     resolved,
		store:        sqlStore,
		documents:    make(map[string]*fullSystemDocument),
		seedEntities: make([]implicitmatcher.RegisteredEntity, 0),
	}
	session.resetIndexesLocked()
	return session
}

func (s *FullSystemSession) setStore(sqlStore *store.SQLiteStore) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.store = sqlStore
}

func (s *FullSystemSession) resetIndexesLocked() {
	if s.resolved.Features.QGram {
		s.qgramIndex = qgram.NewQGramIndex(3)
	} else {
		s.qgramIndex = nil
	}

	if s.resolved.Features.GLDR {
		cfg := s.resolved.GLDRConfig
		s.gldrIndex = fullsystemindex.NewGLDREngine(cfg)
	} else {
		s.gldrIndex = nil
	}

	if s.resolved.Features.Raptor {
		cfg := s.resolved.RaptorConfig
		s.raptorIndex = raptor.NewRaptorIndex(cfg)
	} else {
		s.raptorIndex = nil
	}
}

// IngestDocuments stages one or more documents into the session.
func (s *FullSystemSession) IngestDocuments(req IngestRequest) (*IngestResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(req.Documents) == 0 {
		return nil, fmt.Errorf("ingest requires at least one document")
	}

	buildFeatures := s.resolved.Features
	if req.Retrieval != nil {
		if req.Retrieval.QGram != nil {
			buildFeatures.QGram = *req.Retrieval.QGram && s.resolved.Features.QGram
		}
		if req.Retrieval.GLDR != nil {
			buildFeatures.GLDR = *req.Retrieval.GLDR && s.resolved.Features.GLDR
		}
		if req.Retrieval.Raptor != nil {
			buildFeatures.Raptor = *req.Retrieval.Raptor && s.resolved.Features.Raptor
		}
	}

	combinedSeeds := s.mergeSeedsLocked(req.SeedEntities)
	pending := make([]*fullSystemDocument, 0, len(req.Documents))

	for _, input := range req.Documents {
		docID := normalizeDocumentID(input)
		if _, exists := s.documents[docID]; exists {
			return nil, fmt.Errorf("document %q already exists in session %s", docID, s.ID)
		}
		input.DocumentID = docID

		artifact, err := s.processDocumentLocked(input, req.Scope, combinedSeeds)
		if err != nil {
			return nil, err
		}
		pending = append(pending, artifact)
	}

	for _, artifact := range pending {
		if err := s.indexDocumentLocked(artifact, buildFeatures); err != nil {
			return nil, err
		}
		s.documents[artifact.Input.DocumentID] = artifact
	}

	s.dirty = true

	return s.buildIngestResultLocked(), nil
}

// Search runs grouped retrieval over the staged session state.
func (s *FullSystemSession) Search(req SearchRequest) (*SearchResult, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if strings.TrimSpace(req.Query) == "" {
		return nil, fmt.Errorf("search query is required")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}

	targets, warnings := s.resolveTargetsLocked(req.Targets)
	result := &SearchResult{
		SessionID: s.ID,
		Query:     req.Query,
		Limit:     limit,
		Targets:   targets,
		Warnings:  warnings,
	}

	qgramScope := buildQGramScope(req.Scope)

	for _, target := range targets {
		switch target {
		case SearchTargetQGram:
			if s.qgramIndex == nil {
				result.Warnings = append(result.Warnings, "qgram index is not available in this session")
				continue
			}
			cfg := qgram.DefaultSearchConfig()
			cfg.Scope = qgramScope
			hits := s.qgramIndex.Search(req.Query, cfg, limit)
			result.QGram = make([]QGramSearchHit, len(hits))
			for i, hit := range hits {
				result.QGram[i] = QGramSearchHit{
					DocID:    hit.DocID,
					Score:    hit.Score,
					Coverage: hit.Coverage,
				}
			}
		case SearchTargetGLDRChunks:
			if s.gldrIndex == nil {
				result.Warnings = append(result.Warnings, "gldr chunk index is not available in this session")
				continue
			}
			result.GLDRChunks = s.gldrIndex.Search(req.Query, limit, qgramScope)
		case SearchTargetGLDRNodes:
			if s.gldrIndex == nil {
				result.Warnings = append(result.Warnings, "gldr node index is not available in this session")
				continue
			}
			result.GLDRNodes = s.gldrIndex.SearchNodes(req.Query, limit, qgramScope)
		case SearchTargetRaptor:
			if s.raptorIndex == nil {
				result.Warnings = append(result.Warnings, "raptor index is not available in this session")
				continue
			}

			var queryVec []float32
			if s.resolved.Embedder != nil {
				vecs, err := s.resolved.Embedder.EmbedTexts([]string{req.Query})
				if err != nil {
					result.Warnings = append(result.Warnings, "raptor query embedding failed: "+err.Error())
					continue
				}
				if len(vecs) > 0 {
					queryVec = vecs[0]
				}
			}

			hits := s.raptorIndex.Search(req.Query, queryVec, limit)
			result.Raptor = make([]RaptorSearchHit, len(hits))
			for i, hit := range hits {
				result.Raptor[i] = RaptorSearchHit{
					DocID:    hit.DocID,
					ChunkID:  hit.ChunkID,
					Start:    hit.Start,
					End:      hit.End,
					Score:    hit.Score,
					LexScore: hit.LexScore,
					VecScore: hit.VecScore,
				}
			}
		}
	}

	return result, nil
}

// GetState returns the current lifecycle state.
func (s *FullSystemSession) GetState() *SessionState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return &SessionState{
		SessionID: s.ID,
		Chunking: FullSystemChunkingConfig{
			Strategy:  s.resolved.Chunking.Strategy,
			ChunkSize: s.resolved.Chunking.ChunkSize,
			Overlap:   s.resolved.Chunking.Overlap,
		},
		Features:         s.resolved.Features,
		PersistenceMode:  s.resolved.Persistence.Mode,
		DocumentCount:    len(s.documents),
		Dirty:            s.dirty,
		Committed:        s.committed,
		CommitCount:      s.commitCount,
		AvailableTargets: s.availableTargetsLocked(),
	}
}

// GetStats returns the current aggregate metrics for the session.
func (s *FullSystemSession) GetStats() *SessionStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	chunkStats, graphSummary, entitySummary, discoverySummary, retrievalSummary, _ := s.aggregateLocked()
	return &SessionStats{
		SessionID:        s.ID,
		ChunkStats:       chunkStats,
		DocumentGraph:    graphSummary,
		EntitySummary:    entitySummary,
		DiscoverySummary: discoverySummary,
		RetrievalSummary: retrievalSummary,
		PersistenceSummary: FullSystemPersistenceSummary{
			Mode:        s.resolved.Persistence.Mode,
			Dirty:       s.dirty,
			Committed:   s.committed,
			CommitCount: s.commitCount,
			HasStore:    s.store != nil,
		},
	}
}

// Close disposes all in-memory session state.
func (s *FullSystemSession) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.clearDocumentsLocked()
	s.qgramIndex = nil
	s.gldrIndex = nil
	s.raptorIndex = nil
	s.seedEntities = nil
}

func (s *FullSystemSession) clearDocumentsLocked() {
	for _, doc := range s.documents {
		if doc.DocumentGraph != nil {
			doc.DocumentGraph.Dispose()
		}
	}
	s.documents = make(map[string]*fullSystemDocument)
}

func (s *FullSystemSession) mergeSeedsLocked(seeds []SeedEntity) []implicitmatcher.RegisteredEntity {
	known := make(map[string]implicitmatcher.RegisteredEntity, len(s.seedEntities)+len(seeds))
	for _, seed := range s.seedEntities {
		key := seedKey(seed)
		known[key] = seed
	}

	for _, seed := range seeds {
		registered := seed.toRegisteredEntity()
		key := seedKey(registered)
		known[key] = registered
	}

	keys := make([]string, 0, len(known))
	for key := range known {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	merged := make([]implicitmatcher.RegisteredEntity, 0, len(keys))
	for _, key := range keys {
		merged = append(merged, known[key])
	}
	s.seedEntities = merged
	return merged
}

func (s *FullSystemSession) processDocumentLocked(input IngestDocumentInput, requestScope *FullSystemScope, seeds []implicitmatcher.RegisteredEntity) (*fullSystemDocument, error) {
	conductor, err := s.newSeededConductorLocked(seeds)
	if err != nil {
		return nil, err
	}

	scope := normalizeScope(requestScope, input.Scope)
	input.Scope = &scope
	if strings.TrimSpace(input.Title) == "" {
		input.Title = input.DocumentID
	}
	noteID := input.NoteID
	if strings.TrimSpace(noteID) == "" {
		noteID = "fullsystem:" + input.DocumentID
	}
	input.NoteID = noteID

	chapters, searchChunks, parentCount, hasFrontMatter, warnings, err := s.buildChapterInputsLocked(input.DocumentID, input.Text)
	if err != nil {
		return nil, err
	}

	docGraph, err := conductor.IngestDocument(input.DocumentID, input.Text, chapters)
	if err != nil {
		return nil, fmt.Errorf("ingest document %q: %w", input.DocumentID, err)
	}

	chunkMentions := buildChunkMentionMap(docGraph.Registry)
	for i := range searchChunks {
		key := fullSystemChunkKey{
			ChapterID: searchChunks[i].ChapterID,
			ChunkID:   searchChunks[i].GraptorChunkID,
		}
		searchChunks[i].Mentions = append([]fullsystemindex.Mention{}, chunkMentions[key]...)
	}

	discoveryCandidates := extractDiscoveryCandidates(conductor)

	return &fullSystemDocument{
		Input:                 input,
		Scope:                 scope,
		NoteID:                noteID,
		Strategy:              s.resolved.Chunking.Strategy,
		ChapterCount:          len(chapters),
		ParentCount:           parentCount,
		LeafCount:             len(searchChunks),
		HasFrontMatterChapter: hasFrontMatter,
		SearchChunks:          searchChunks,
		DocumentGraph:         docGraph,
		DiscoveryCandidates:   discoveryCandidates,
		Warnings:              warnings,
	}, nil
}

func (s *FullSystemSession) newSeededConductorLocked(seeds []implicitmatcher.RegisteredEntity) (*GraptorConductor, error) {
	cfg := DefaultConductorConfig()
	cfg.MaxHistory = 200
	cfg.CarryOverSize = 20

	conductor, err := NewGraptorConductor(cfg)
	if err != nil {
		return nil, err
	}

	if len(seeds) == 0 {
		return conductor, nil
	}

	dict, err := implicitmatcher.Compile(seeds)
	if err != nil {
		return nil, fmt.Errorf("compile seed dictionary: %w", err)
	}

	conductor.SetDictionary(dict)
	conductor.SeedRegistry(seeds)
	if s.resolved.Features.Discovery {
		conductor.SeedDiscovery(seeds)
	}

	return conductor, nil
}

func (s *FullSystemSession) buildChapterInputsLocked(docID, text string) ([]ChapterInput, []fullSystemChunk, int, bool, []string, error) {
	switch s.resolved.Chunking.Strategy {
	case ChunkingStrategyChunkerX2:
		return s.buildChunkerX2InputsLocked(docID, text)
	case ChunkingStrategyChapterParagraphLegacy:
		return s.buildLegacyInputsLocked(docID, text)
	default:
		return nil, nil, 0, false, nil, fmt.Errorf("unsupported chunking strategy %q", s.resolved.Chunking.Strategy)
	}
}

func (s *FullSystemSession) buildChunkerX2InputsLocked(docID, text string) ([]ChapterInput, []fullSystemChunk, int, bool, []string, error) {
	chunker := docchunker.NewChunkerX2(s.resolved.Chunking.ChunkSize, s.resolved.Chunking.Overlap)
	tree := chunker.ChunkDocumentExtended(docID, text)

	chapterSpecs := buildChunkerChapterSpecs(text, tree.Chapters)
	hasFrontMatter := len(chapterSpecs) > 0 && chapterSpecs[0].ChapterID == 0

	chapterMap := make(map[uint32]*fullSystemChapterSpec, len(chapterSpecs))
	order := make([]uint32, 0, len(chapterSpecs))
	for i := range chapterSpecs {
		spec := &chapterSpecs[i]
		chapterMap[spec.ChapterID] = spec
		order = append(order, spec.ChapterID)
	}

	searchChunks := make([]fullSystemChunk, 0, len(tree.Leaves))
	warnings := make([]string, 0)

	leaves := append([]docchunker.Chunk{}, tree.Leaves...)
	sort.Slice(leaves, func(i, j int) bool { return leaves[i].Start < leaves[j].Start })

	for _, leaf := range leaves {
		chapterID, fallback := assignLeafToChapter(leaf, chapterSpecs)
		spec := chapterMap[chapterID]
		if spec == nil {
			continue
		}
		if fallback {
			warnings = append(warnings, fmt.Sprintf("leaf %d crossed chapter boundaries and was attached to chapter %d by overlap", leaf.ID, chapterID))
		}

		spec.Leaves = append(spec.Leaves, LeafInput{
			ChunkID: leaf.ID,
			Text:    leaf.Text,
			Start:   leaf.Start,
			End:     leaf.End,
		})

		searchChunks = append(searchChunks, fullSystemChunk{
			SearchID:       makeSearchChunkID(docID, chapterID, leaf.ID, leaf.Start, leaf.End),
			ChapterID:      chapterID,
			GraptorChunkID: leaf.ID,
			ParentID:       leaf.ParentID,
			Start:          leaf.Start,
			End:            leaf.End,
			Text:           leaf.Text,
		})
	}

	chapters := make([]ChapterInput, 0, len(order))
	for _, chapterID := range order {
		spec := chapterMap[chapterID]
		sort.Slice(spec.Leaves, func(i, j int) bool { return spec.Leaves[i].Start < spec.Leaves[j].Start })
		chapters = append(chapters, ChapterInput{
			ChapterID: chapterID,
			Text:      spec.Text,
			Leaves:    append([]LeafInput{}, spec.Leaves...),
		})
	}

	sort.Slice(searchChunks, func(i, j int) bool {
		if searchChunks[i].Start == searchChunks[j].Start {
			if searchChunks[i].ChapterID == searchChunks[j].ChapterID {
				return searchChunks[i].SearchID < searchChunks[j].SearchID
			}
			return searchChunks[i].ChapterID < searchChunks[j].ChapterID
		}
		return searchChunks[i].Start < searchChunks[j].Start
	})

	return chapters, searchChunks, len(tree.Parents), hasFrontMatter, dedupeStrings(warnings), nil
}

func (s *FullSystemSession) buildLegacyInputsLocked(docID, text string) ([]ChapterInput, []fullSystemChunk, int, bool, []string, error) {
	ranges := parseLegacyChapterRanges(text)
	if len(ranges) == 0 {
		ranges = []fullSystemChapterSpec{{
			ChapterID: 0,
			Start:     0,
			End:       len(text),
			Title:     "document",
			Text:      strings.TrimSpace(text),
		}}
	}

	chapters := make([]ChapterInput, 0, len(ranges))
	searchChunks := make([]fullSystemChunk, 0)
	hasFrontMatter := len(ranges) > 0 && ranges[0].ChapterID == 0

	for _, rng := range ranges {
		leaves := buildParagraphLeaves(text[rng.Start:rng.End], rng.Start)
		chapters = append(chapters, ChapterInput{
			ChapterID: rng.ChapterID,
			Text:      rng.Text,
			Leaves:    append([]LeafInput{}, leaves...),
		})

		for _, leaf := range leaves {
			searchChunks = append(searchChunks, fullSystemChunk{
				SearchID:       makeSearchChunkID(docID, rng.ChapterID, leaf.ChunkID, leaf.Start, leaf.End),
				ChapterID:      rng.ChapterID,
				GraptorChunkID: leaf.ChunkID,
				ParentID:       0,
				Start:          leaf.Start,
				End:            leaf.End,
				Text:           leaf.Text,
			})
		}
	}

	return chapters, searchChunks, 0, hasFrontMatter, nil, nil
}

func (s *FullSystemSession) indexDocumentLocked(doc *fullSystemDocument, features FullSystemResolvedFeatures) error {
	if features.QGram && s.qgramIndex != nil {
		for _, chunk := range doc.SearchChunks {
			s.qgramIndex.IndexDocumentScoped(chunk.SearchID, map[string]string{"content": chunk.Text}, doc.Scope.NarrativeID, doc.Scope.FolderPath)
		}
	}

	if features.GLDR && s.gldrIndex != nil {
		entities := doc.DocumentGraph.Registry.GetAllEntities()
		for _, entity := range entities {
			s.gldrIndex.RegisterEntity(entity.CanonicalName, entity.ID)
			for _, alias := range entity.Aliases {
				s.gldrIndex.RegisterEntity(alias, entity.ID)
			}
		}

		for _, chunk := range doc.SearchChunks {
			s.gldrIndex.IndexChunk(chunk.SearchID, map[string]string{"content": chunk.Text}, chunk.Mentions)
		}
		chapters := doc.DocumentGraph.GetChapters()
		chapterIDs := make([]uint32, 0, len(chapters))
		for chapterID := range chapters {
			chapterIDs = append(chapterIDs, chapterID)
		}
		sort.Slice(chapterIDs, func(i, j int) bool { return chapterIDs[i] < chapterIDs[j] })
		for _, chapterID := range chapterIDs {
			chapter := chapters[chapterID]
			if chapter == nil || chapter.Graph == nil {
				continue
			}
			for _, edge := range chapter.Graph.AllEdges() {
				s.gldrIndex.AddGraphEdge(fullsystemindex.GraphEdge{
					SourceID:   edge.Source.ID,
					TargetID:   edge.Target.ID,
					RelType:    edge.Edge.Relation,
					Confidence: edge.Edge.Weight,
					Source:     "narrative_projection",
				})
			}
		}
		for _, edge := range doc.DocumentGraph.CrossChapterEdges {
			s.gldrIndex.AddGraphEdge(fullsystemindex.GraphEdge{
				SourceID:   edge.SourceID,
				TargetID:   edge.TargetID,
				RelType:    edge.RelationType,
				Confidence: edge.Confidence,
				Source:     "cross_chapter",
			})
		}
		cooccurrences := doc.DocumentGraph.Cooccurrence.GetAllPairs(1)
		maxCooccurrence := 1
		for _, pair := range cooccurrences {
			if pair.Count > maxCooccurrence {
				maxCooccurrence = pair.Count
			}
		}
		for _, pair := range cooccurrences {
			confidence := float64(pair.Count) / float64(maxCooccurrence)
			s.gldrIndex.AddBidirectionalEdge(pair.Entity1ID, pair.Entity2ID, "cooccurs", confidence, "cooccurrence")
		}
	}

	if features.Raptor && s.raptorIndex != nil {
		chunkTexts := make([]string, 0, len(doc.SearchChunks))
		for _, chunk := range doc.SearchChunks {
			chunkTexts = append(chunkTexts, chunk.Text)
		}
		vecs, err := s.embedTexts(chunkTexts)
		if err != nil {
			return err
		}
		if _, err := s.raptorIndex.IngestChunks(doc.Input.DocumentID, chunkTexts, vecs); err != nil {
			return fmt.Errorf("index raptor document %q: %w", doc.Input.DocumentID, err)
		}
	}

	return nil
}

func (s *FullSystemSession) embedTexts(texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	if s.resolved.Embedder == nil {
		return nil, fmt.Errorf("raptor requires an embedding provider")
	}
	vecs, err := s.resolved.Embedder.EmbedTexts(texts)
	if err != nil {
		return nil, err
	}
	if len(vecs) != len(texts) {
		return nil, fmt.Errorf("embedding provider returned %d vectors for %d texts", len(vecs), len(texts))
	}
	return vecs, nil
}

// Commit persists staged canonical artifacts to SQLite.
func (s *FullSystemSession) Commit(req CommitRequest) (*CommitResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.store == nil {
		return nil, fmt.Errorf("sqlite store is not configured")
	}
	if s.resolved.Persistence.Mode != PersistenceModeExplicitCommit {
		return nil, fmt.Errorf("unsupported persistence mode %q", s.resolved.Persistence.Mode)
	}
	if !s.dirty {
		return &CommitResult{
			SessionID:        s.ID,
			AlreadyCommitted: s.committed,
		}, nil
	}

	now := time.Now().Unix()
	result := &CommitResult{SessionID: s.ID}
	warnings := make([]string, 0)

	uniqueEntities := make(map[string]*Entity)
	uniqueCandidates := make(map[string]discovery.Candidate)
	scopeEntities := make(map[string]map[string]persistedEntityManifest)
	scopeDocuments := make(map[string][]persistedDocumentManifest)
	seenEdges := make(map[string]bool)
	seenSpans := make(map[string]bool)

	docIDs := make([]string, 0, len(s.documents))
	for docID := range s.documents {
		docIDs = append(docIDs, docID)
	}
	sort.Strings(docIDs)

	for _, docID := range docIDs {
		doc := s.documents[docID]
		scope := normalizeScope(req.Scope, &doc.Scope)
		scopeKey := scope.ScopeFolderID()

		note := buildStoreNote(doc, scope, now)
		if err := s.store.UpsertNote(note); err != nil {
			return nil, fmt.Errorf("commit note %q: %w", docID, err)
		}
		result.Notes++

		entities := doc.DocumentGraph.Registry.GetAllEntities()
		sort.Slice(entities, func(i, j int) bool { return entities[i].ID < entities[j].ID })

		if scopeEntities[scopeKey] == nil {
			scopeEntities[scopeKey] = make(map[string]persistedEntityManifest)
		}

		for _, entity := range entities {
			uniqueEntities[entity.ID] = entity
			scopeEntities[scopeKey][entity.ID] = persistedEntityManifest{
				ID:      entity.ID,
				Name:    entity.CanonicalName,
				Aliases: append([]string{}, entity.Aliases...),
			}
		}

		for _, chunk := range doc.SearchChunks {
			for _, mention := range chunk.Mentions {
				absStart := chunk.Start + mention.Start
				absEnd := chunk.Start + mention.End
				mentionText := sliceByOffsets(chunk.Text, mention.Start, mention.End)
				spanID := stableID("span", doc.NoteID, mention.EntityID, fmt.Sprintf("%d", chunk.ChapterID), fmt.Sprintf("%d", absStart), fmt.Sprintf("%d", absEnd), mentionText)
				if seenSpans[spanID] {
					continue
				}
				seenSpans[spanID] = true

				span := &store.Span{
					ID:          spanID,
					WorldID:     scope.WorldID,
					NoteID:      doc.NoteID,
					NarrativeID: scope.NarrativeID,
					Start:       absStart,
					End:         absEnd,
					Text:        mentionText,
					ContentHash: stableID("spanhash", mentionText),
					SpanKind:    "entity_mention",
					Status:      "resolved",
					CreatedBy:   "graptor",
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if err := s.store.UpsertSpan(span); err != nil {
					return nil, fmt.Errorf("commit span %q: %w", span.ID, err)
				}
				result.Spans++

				spanMention := &store.SpanMention{
					ID:                stableID("spanmention", span.ID, mention.EntityID),
					SpanID:            span.ID,
					CandidateEntityID: mention.EntityID,
					MatchType:         "exact",
					Confidence:        mention.Confidence,
					Status:            "resolved",
					CreatedAt:         now,
					UpdatedAt:         now,
				}
				if err := s.store.UpsertSpanMention(spanMention); err != nil {
					return nil, fmt.Errorf("commit span mention %q: %w", spanMention.ID, err)
				}
				result.Mentions++
			}
		}

		docManifest := persistedDocumentManifest{
			SessionID:             s.ID,
			DocumentID:            doc.Input.DocumentID,
			NoteID:                doc.NoteID,
			Title:                 doc.Input.Title,
			Scope:                 scope,
			Strategy:              doc.Strategy,
			ChapterCount:          doc.ChapterCount,
			ParentCount:           doc.ParentCount,
			LeafCount:             doc.LeafCount,
			HasFrontMatterChapter: doc.HasFrontMatterChapter,
			Chunks:                make([]persistedChunkManifest, 0, len(doc.SearchChunks)),
		}

		for _, chunk := range doc.SearchChunks {
			persistedMentions := make([]persistedMentionManifest, len(chunk.Mentions))
			for i, mention := range chunk.Mentions {
				persistedMentions[i] = persistedMentionManifest{
					EntityID:   mention.EntityID,
					Confidence: mention.Confidence,
					Start:      mention.Start,
					End:        mention.End,
				}
			}

			docManifest.Chunks = append(docManifest.Chunks, persistedChunkManifest{
				ChunkID:        chunk.SearchID,
				ChapterID:      chunk.ChapterID,
				GraptorChunkID: chunk.GraptorChunkID,
				ParentID:       chunk.ParentID,
				Start:          chunk.Start,
				End:            chunk.End,
				Text:           chunk.Text,
				Mentions:       persistedMentions,
			})
		}

		chapters := doc.DocumentGraph.GetChapters()
		chapterIDs := make([]uint32, 0, len(chapters))
		for chapterID := range chapters {
			chapterIDs = append(chapterIDs, chapterID)
		}
		sort.Slice(chapterIDs, func(i, j int) bool { return chapterIDs[i] < chapterIDs[j] })

		for _, chapterID := range chapterIDs {
			chapter := chapters[chapterID]
			if chapter == nil || chapter.Graph == nil {
				continue
			}
			for _, edge := range chapter.Graph.AllEdges() {
				edgeID := stableID("edge", doc.Input.DocumentID, fmt.Sprintf("%d", chapterID), edge.Source.ID, edge.Target.ID, edge.Edge.Relation)
				if seenEdges[edgeID] {
					continue
				}
				seenEdges[edgeID] = true

				storeEdge := &store.Edge{
					ID:            edgeID,
					SourceID:      edge.Source.ID,
					TargetID:      edge.Target.ID,
					RelType:       edge.Edge.Relation,
					Confidence:    edge.Edge.Weight,
					Bidirectional: false,
					SourceNote:    doc.NoteID,
					CreatedAt:     now,
				}
				if err := s.store.UpsertEdge(storeEdge); err != nil {
					return nil, fmt.Errorf("commit edge %q: %w", storeEdge.ID, err)
				}
				result.Edges++

				docManifest.Edges = append(docManifest.Edges, persistedGraphEdgeManifest{
					SourceID:      edge.Source.ID,
					TargetID:      edge.Target.ID,
					RelType:       edge.Edge.Relation,
					Confidence:    edge.Edge.Weight,
					Source:        "narrative_projection",
					SourceChapter: chapterID,
				})
			}
		}

		for _, edge := range doc.DocumentGraph.CrossChapterEdges {
			edgeID := stableID("crossedge", doc.Input.DocumentID, fmt.Sprintf("%d", edge.SourceChapter), fmt.Sprintf("%d", edge.TargetChapter), edge.SourceID, edge.TargetID, edge.RelationType)
			if seenEdges[edgeID] {
				continue
			}
			seenEdges[edgeID] = true

			storeEdge := &store.Edge{
				ID:            edgeID,
				SourceID:      edge.SourceID,
				TargetID:      edge.TargetID,
				RelType:       edge.RelationType,
				Confidence:    edge.Confidence,
				Bidirectional: false,
				SourceNote:    doc.NoteID,
				CreatedAt:     now,
			}
			if err := s.store.UpsertEdge(storeEdge); err != nil {
				return nil, fmt.Errorf("commit cross-chapter edge %q: %w", storeEdge.ID, err)
			}
			result.Edges++

			docManifest.Edges = append(docManifest.Edges, persistedGraphEdgeManifest{
				SourceID:      edge.SourceID,
				TargetID:      edge.TargetID,
				RelType:       edge.RelationType,
				Confidence:    edge.Confidence,
				Source:        "cross_chapter",
				SourceChapter: edge.SourceChapter,
				TargetChapter: edge.TargetChapter,
			})
		}

		cooccurrences := doc.DocumentGraph.Cooccurrence.GetAllPairs(1)
		maxCooccurrence := 1
		for _, pair := range cooccurrences {
			if pair.Count > maxCooccurrence {
				maxCooccurrence = pair.Count
			}
		}
		for _, pair := range cooccurrences {
			edgeID := stableID("coocedge", doc.Input.DocumentID, pair.Entity1ID, pair.Entity2ID)
			if seenEdges[edgeID] {
				continue
			}
			seenEdges[edgeID] = true

			confidence := float64(pair.Count) / float64(maxCooccurrence)
			storeEdge := &store.Edge{
				ID:            edgeID,
				SourceID:      pair.Entity1ID,
				TargetID:      pair.Entity2ID,
				RelType:       "CO_OCCURS",
				Confidence:    confidence,
				Bidirectional: true,
				SourceNote:    doc.NoteID,
				CreatedAt:     now,
			}
			if err := s.store.UpsertEdge(storeEdge); err != nil {
				return nil, fmt.Errorf("commit cooccurrence edge %q: %w", storeEdge.ID, err)
			}
			result.Edges++

			docManifest.Cooccurrences = append(docManifest.Cooccurrences, persistedCooccurrenceManifest{
				Entity1ID: pair.Entity1ID,
				Entity2ID: pair.Entity2ID,
				Count:     pair.Count,
			})
		}

		for _, candidate := range doc.DiscoveryCandidates {
			tokenKey := strings.ToLower(strings.TrimSpace(candidate.Token))
			if tokenKey == "" {
				continue
			}
			if _, exists := uniqueCandidates[tokenKey]; !exists {
				uniqueCandidates[tokenKey] = candidate
			}
		}

		scopeDocuments[scopeKey] = append(scopeDocuments[scopeKey], docManifest)
	}

	entityIDs := make([]string, 0, len(uniqueEntities))
	for entityID := range uniqueEntities {
		entityIDs = append(entityIDs, entityID)
	}
	sort.Strings(entityIDs)

	for _, entityID := range entityIDs {
		entity := uniqueEntities[entityID]
		storeEntity := &store.Entity{
			ID:            entity.ID,
			Label:         entity.CanonicalName,
			Kind:          string(entity.Kind),
			Aliases:       append([]string{}, entity.Aliases...),
			FirstNote:     findEntityFirstNote(entity.ID, s.documents),
			TotalMentions: entity.TotalMentions,
			NarrativeID:   findEntityNarrativeID(entity.ID, s.documents),
			CreatedBy:     "graptor",
			CreatedAt:     entity.CreatedAt,
			UpdatedAt:     now,
		}
		if err := s.store.UpsertEntity(storeEntity); err != nil {
			return nil, fmt.Errorf("commit entity %q: %w", entity.ID, err)
		}
		result.Entities++
		if len(entity.Aliases) > 0 {
			result.Aliases += len(entity.Aliases)
		}
	}

	candidateKeys := make([]string, 0, len(uniqueCandidates))
	for token := range uniqueCandidates {
		candidateKeys = append(candidateKeys, token)
	}
	sort.Strings(candidateKeys)

	for _, token := range candidateKeys {
		candidate := uniqueCandidates[token]
		kind := implicitmatcher.ParseKind(candidate.Kind)
		storeCandidate := &store.DiscoveryCandidate{
			Token:     candidate.Token,
			Kind:      int(kind),
			Score:     candidate.Score,
			Status:    candidate.Status,
			FirstSeen: now,
			LastSeen:  now,
			Count:     candidate.Count,
		}
		if err := s.store.UpsertDiscoveryCandidate(storeCandidate); err != nil {
			return nil, fmt.Errorf("commit discovery candidate %q: %w", candidate.Token, err)
		}
		result.DiscoveryCandidates++
	}

	for scopeKey, manifests := range scopeDocuments {
		sort.Slice(manifests, func(i, j int) bool { return manifests[i].DocumentID < manifests[j].DocumentID })
		scopeFolderID := scopeKey

		for _, manifest := range manifests {
			payload, err := json.Marshal(manifest)
			if err != nil {
				return nil, fmt.Errorf("marshal document manifest %q: %w", manifest.DocumentID, err)
			}

			scopedDoc := &store.ScopedDocument{
				ID:            stableID("scopedmanifest", scopeFolderID, scopedNamespaceChunkManifest, manifest.DocumentID),
				ScopeFolderID: scopeFolderID,
				NarrativeID:   manifest.Scope.NarrativeID,
				Namespace:     scopedNamespaceChunkManifest,
				DocumentKey:   manifest.DocumentID,
				Payload:       string(payload),
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if err := s.store.UpsertScopedDocument(scopedDoc); err != nil {
				return nil, fmt.Errorf("commit scoped manifest %q: %w", manifest.DocumentID, err)
			}
			result.ScopedManifestsWritten++
		}

		entityMap := scopeEntities[scopeKey]
		entityList := make([]persistedEntityManifest, 0, len(entityMap))
		for _, entity := range entityMap {
			entityList = append(entityList, entity)
		}
		sort.Slice(entityList, func(i, j int) bool { return entityList[i].ID < entityList[j].ID })

		docResults := make([]IngestDocumentResult, 0, len(manifests))
		for _, manifest := range manifests {
			docResults = append(docResults, IngestDocumentResult{
				DocumentID:            manifest.DocumentID,
				Title:                 manifest.Title,
				ChapterCount:          manifest.ChapterCount,
				ParentCount:           manifest.ParentCount,
				LeafCount:             manifest.LeafCount,
				HasFrontMatterChapter: manifest.HasFrontMatterChapter,
			})
		}

		sessionManifest := persistedSessionManifest{
			SessionID:   s.ID,
			CommittedAt: now,
			Documents:   docResults,
			Entities:    entityList,
		}
		payload, err := json.Marshal(sessionManifest)
		if err != nil {
			return nil, fmt.Errorf("marshal session manifest: %w", err)
		}

		narrativeID := ""
		if len(manifests) > 0 {
			narrativeID = manifests[0].Scope.NarrativeID
		}

		scopedDoc := &store.ScopedDocument{
			ID:            stableID("scopedsession", scopeFolderID, scopedNamespaceSessionManifest, "latest"),
			ScopeFolderID: scopeFolderID,
			NarrativeID:   narrativeID,
			Namespace:     scopedNamespaceSessionManifest,
			DocumentKey:   "latest",
			Payload:       string(payload),
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := s.store.UpsertScopedDocument(scopedDoc); err != nil {
			return nil, fmt.Errorf("commit session manifest: %w", err)
		}
		result.ScopedManifestsWritten++
	}

	result.Warnings = warnings
	s.dirty = false
	s.committed = true
	s.commitCount++

	return result, nil
}

// LoadCommittedScope rebuilds retrieval indexes from scoped manifests.
func (s *FullSystemSession) LoadCommittedScope(scope FullSystemScope) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.store == nil {
		return fmt.Errorf("sqlite store is not configured")
	}

	scope = normalizeScope(&scope, nil)
	scopeFolderID := scope.ScopeFolderID()

	sessionManifestDoc, err := s.store.GetScopedDocument(scopeFolderID, scopedNamespaceSessionManifest, "latest")
	if err != nil {
		return fmt.Errorf("load session manifest: %w", err)
	}

	var sessionManifest persistedSessionManifest
	if sessionManifestDoc != nil && strings.TrimSpace(sessionManifestDoc.Payload) != "" {
		if err := json.Unmarshal([]byte(sessionManifestDoc.Payload), &sessionManifest); err != nil {
			return fmt.Errorf("parse session manifest: %w", err)
		}
	}

	documentManifests, err := s.store.ListScopedDocuments(scopeFolderID, scopedNamespaceChunkManifest)
	if err != nil {
		return fmt.Errorf("list chunk manifests: %w", err)
	}

	s.clearDocumentsLocked()
	s.resetIndexesLocked()

	if s.gldrIndex != nil {
		for _, entity := range sessionManifest.Entities {
			s.gldrIndex.RegisterEntity(entity.Name, entity.ID)
			for _, alias := range entity.Aliases {
				s.gldrIndex.RegisterEntity(alias, entity.ID)
			}
		}
	}

	sort.Slice(documentManifests, func(i, j int) bool { return documentManifests[i].DocumentKey < documentManifests[j].DocumentKey })

	for _, scopedDoc := range documentManifests {
		var manifest persistedDocumentManifest
		if err := json.Unmarshal([]byte(scopedDoc.Payload), &manifest); err != nil {
			return fmt.Errorf("parse chunk manifest %q: %w", scopedDoc.DocumentKey, err)
		}

		doc := &fullSystemDocument{
			Input: IngestDocumentInput{
				DocumentID: manifest.DocumentID,
				Title:      manifest.Title,
				NoteID:     manifest.NoteID,
			},
			Scope:                 manifest.Scope,
			NoteID:                manifest.NoteID,
			Strategy:              manifest.Strategy,
			ChapterCount:          manifest.ChapterCount,
			ParentCount:           manifest.ParentCount,
			LeafCount:             manifest.LeafCount,
			HasFrontMatterChapter: manifest.HasFrontMatterChapter,
			SearchChunks:          make([]fullSystemChunk, 0, len(manifest.Chunks)),
		}

		chunkTexts := make([]string, 0, len(manifest.Chunks))
		for _, chunk := range manifest.Chunks {
			mentions := make([]fullsystemindex.Mention, len(chunk.Mentions))
			for i, mention := range chunk.Mentions {
				mentions[i] = fullsystemindex.Mention{
					EntityID:   mention.EntityID,
					Confidence: mention.Confidence,
					Start:      mention.Start,
					End:        mention.End,
				}
			}

			searchChunk := fullSystemChunk{
				SearchID:       chunk.ChunkID,
				ChapterID:      chunk.ChapterID,
				GraptorChunkID: chunk.GraptorChunkID,
				ParentID:       chunk.ParentID,
				Start:          chunk.Start,
				End:            chunk.End,
				Text:           chunk.Text,
				Mentions:       mentions,
			}
			doc.SearchChunks = append(doc.SearchChunks, searchChunk)
			chunkTexts = append(chunkTexts, chunk.Text)

			if s.qgramIndex != nil {
				s.qgramIndex.IndexDocumentScoped(chunk.ChunkID, map[string]string{"content": chunk.Text}, manifest.Scope.NarrativeID, manifest.Scope.FolderPath)
			}
			if s.gldrIndex != nil {
				s.gldrIndex.IndexChunk(chunk.ChunkID, map[string]string{"content": chunk.Text}, mentions)
			}
		}

		if s.gldrIndex != nil {
			for _, edge := range manifest.Edges {
				s.gldrIndex.AddGraphEdge(fullsystemindex.GraphEdge{
					SourceID:   edge.SourceID,
					TargetID:   edge.TargetID,
					RelType:    edge.RelType,
					Confidence: edge.Confidence,
					Source:     edge.Source,
				})
			}

			maxCount := 1
			for _, pair := range manifest.Cooccurrences {
				if pair.Count > maxCount {
					maxCount = pair.Count
				}
			}
			for _, pair := range manifest.Cooccurrences {
				confidence := float64(pair.Count) / float64(maxCount)
				s.gldrIndex.AddBidirectionalEdge(pair.Entity1ID, pair.Entity2ID, "cooccurs", confidence, "cooccurrence")
			}
		}

		if s.raptorIndex != nil {
			vecs, err := s.embedTexts(chunkTexts)
			if err != nil {
				return err
			}
			if _, err := s.raptorIndex.IngestChunks(manifest.DocumentID, chunkTexts, vecs); err != nil {
				return fmt.Errorf("hydrate raptor %q: %w", manifest.DocumentID, err)
			}
		}

		s.documents[manifest.DocumentID] = doc
	}

	s.dirty = false
	s.committed = len(s.documents) > 0
	return nil
}

func (s *FullSystemSession) buildIngestResultLocked() *IngestResult {
	chunkStats, graphSummary, entitySummary, discoverySummary, retrievalSummary, warnings := s.aggregateLocked()

	docIDs := make([]string, 0, len(s.documents))
	for docID := range s.documents {
		docIDs = append(docIDs, docID)
	}
	sort.Strings(docIDs)

	documents := make([]IngestDocumentResult, 0, len(docIDs))
	for _, docID := range docIDs {
		doc := s.documents[docID]
		entities := 0
		edges := 0
		if doc.DocumentGraph != nil {
			entities = doc.DocumentGraph.Stats.TotalEntities
			edges = doc.DocumentGraph.Stats.TotalEdges
		}
		documents = append(documents, IngestDocumentResult{
			DocumentID:            doc.Input.DocumentID,
			Title:                 doc.Input.Title,
			ChapterCount:          doc.ChapterCount,
			ParentCount:           doc.ParentCount,
			LeafCount:             doc.LeafCount,
			EntityCount:           entities,
			EdgeCount:             edges,
			HasFrontMatterChapter: doc.HasFrontMatterChapter,
		})
	}

	return &IngestResult{
		SessionID:        s.ID,
		ChunkStats:       chunkStats,
		DocumentGraph:    graphSummary,
		EntitySummary:    entitySummary,
		DiscoverySummary: discoverySummary,
		RetrievalSummary: retrievalSummary,
		Documents:        documents,
		Warnings:         warnings,
	}
}

func (s *FullSystemSession) aggregateLocked() (FullSystemChunkStats, FullSystemGraphSummary, FullSystemEntitySummary, FullSystemDiscoverySummary, FullSystemRetrievalSummary, []string) {
	chunkStats := FullSystemChunkStats{
		Strategy:  s.resolved.Chunking.Strategy,
		ChunkSize: s.resolved.Chunking.ChunkSize,
		Overlap:   s.resolved.Chunking.Overlap,
		Documents: len(s.documents),
	}
	graphSummary := FullSystemGraphSummary{Documents: len(s.documents)}
	retrievalSummary := FullSystemRetrievalSummary{
		RaptorEnabled: s.raptorIndex != nil,
	}

	entityAliases := make(map[string]map[string]bool)
	entityMentions := make(map[string]int)
	multiChapter := make(map[string]bool)
	discoveryCandidates := make(map[string]discovery.Candidate)
	warnings := make([]string, 0)

	docIDs := make([]string, 0, len(s.documents))
	for docID := range s.documents {
		docIDs = append(docIDs, docID)
	}
	sort.Strings(docIDs)

	for _, docID := range docIDs {
		doc := s.documents[docID]

		chunkStats.TotalChapters += doc.ChapterCount
		chunkStats.TotalParents += doc.ParentCount
		chunkStats.TotalLeaves += doc.LeafCount

		graphSummary.TotalChapters += doc.ChapterCount
		graphSummary.TotalLeaves += doc.LeafCount
		if doc.DocumentGraph != nil {
			graphSummary.TotalEdges += doc.DocumentGraph.Stats.TotalEdges
			graphSummary.CrossChapterLinks += doc.DocumentGraph.Stats.CrossChapterLinks
		}

		for _, warning := range doc.Warnings {
			warnings = append(warnings, warning)
		}

		if doc.DocumentGraph != nil && doc.DocumentGraph.Registry != nil {
			entities := doc.DocumentGraph.Registry.GetAllEntities()
			for _, entity := range entities {
				if entityAliases[entity.ID] == nil {
					entityAliases[entity.ID] = make(map[string]bool)
				}
				for _, alias := range entity.Aliases {
					entityAliases[entity.ID][alias] = true
				}
				entityMentions[entity.ID] += entity.TotalMentions
				if len(doc.DocumentGraph.Registry.GetEntityChapters(entity.ID)) > 1 {
					multiChapter[entity.ID] = true
				}
			}
		}

		for _, candidate := range doc.DiscoveryCandidates {
			key := strings.ToLower(strings.TrimSpace(candidate.Token))
			if key == "" {
				continue
			}
			if existing, ok := discoveryCandidates[key]; !ok || candidate.Score > existing.Score {
				discoveryCandidates[key] = candidate
			}
		}
	}

	graphSummary.TotalEntities = len(entityMentions)
	for _, mentions := range entityMentions {
		graphSummary.TotalMentions += mentions
	}

	entitySummary := FullSystemEntitySummary{
		TotalEntities:        len(entityMentions),
		TotalMentions:        graphSummary.TotalMentions,
		MultiChapterEntities: len(multiChapter),
	}
	for _, aliases := range entityAliases {
		entitySummary.TotalAliases += len(aliases)
	}

	discoverySummary := FullSystemDiscoverySummary{
		CandidateCount: len(discoveryCandidates),
	}
	for _, candidate := range discoveryCandidates {
		if candidate.Status == int(discovery.StatusPromoted) {
			discoverySummary.PromotedCount++
		}
	}

	if s.qgramIndex != nil {
		retrievalSummary.QGramDocuments = len(s.qgramIndex.Documents)
	}
	if s.gldrIndex != nil {
		stats := s.gldrIndex.Stats()
		retrievalSummary.GLDRChunks = stats.Chunks
		retrievalSummary.GLDREntities = stats.Entities
		retrievalSummary.GLDREdges = stats.Edges
	}
	if s.raptorIndex != nil {
		retrievalSummary.RaptorDocuments = s.raptorIndex.DocCount()
		retrievalSummary.RaptorLeaves = s.raptorIndex.LeafCount()
	}

	return chunkStats, graphSummary, entitySummary, discoverySummary, retrievalSummary, dedupeStrings(warnings)
}

func (s *FullSystemSession) resolveTargetsLocked(requested []string) ([]string, []string) {
	available := make(map[string]bool)
	for _, target := range s.availableTargetsLocked() {
		available[target] = true
	}

	if len(requested) == 0 {
		return s.availableTargetsLocked(), nil
	}

	targets := make([]string, 0, len(requested))
	warnings := make([]string, 0)
	seen := make(map[string]bool)
	for _, target := range requested {
		target = strings.TrimSpace(strings.ToLower(target))
		if target == "" || seen[target] {
			continue
		}
		seen[target] = true
		if !available[target] {
			warnings = append(warnings, fmt.Sprintf("search target %q is not available in this session", target))
			continue
		}
		targets = append(targets, target)
	}
	return targets, warnings
}

func (s *FullSystemSession) availableTargetsLocked() []string {
	targets := make([]string, 0, 4)
	if s.qgramIndex != nil {
		targets = append(targets, SearchTargetQGram)
	}
	if s.gldrIndex != nil {
		targets = append(targets, SearchTargetGLDRChunks, SearchTargetGLDRNodes)
	}
	if s.raptorIndex != nil {
		targets = append(targets, SearchTargetRaptor)
	}
	return targets
}

func normalizeFullSystemConfig(input *FullSystemConfig) (fullSystemResolvedConfig, error) {
	defaults := DefaultFullSystemConfig()
	resolved := fullSystemResolvedConfig{
		Chunking: FullSystemChunkingConfig{
			Strategy:  defaults.Chunking.Strategy,
			ChunkSize: defaults.Chunking.ChunkSize,
			Overlap:   defaults.Chunking.Overlap,
		},
		Features: FullSystemResolvedFeatures{
			Discovery: true,
			Reality:   true,
			QGram:     true,
			GLDR:      true,
			Raptor:    false,
		},
		Persistence:  defaults.Persistence,
		GLDRConfig:   fullsystemindex.DefaultGLDRConfig(),
		RaptorConfig: raptor.DefaultRaptorConfig(),
	}

	if input == nil {
		resolved.RaptorConfig.ChunkSize = resolved.Chunking.ChunkSize
		resolved.RaptorConfig.Overlap = resolved.Chunking.Overlap
		return resolved, nil
	}

	if strings.TrimSpace(input.Chunking.Strategy) != "" {
		resolved.Chunking.Strategy = strings.TrimSpace(strings.ToLower(input.Chunking.Strategy))
	}
	if input.Chunking.ChunkSize > 0 {
		resolved.Chunking.ChunkSize = input.Chunking.ChunkSize
	}
	if input.Chunking.Overlap > 0 {
		resolved.Chunking.Overlap = input.Chunking.Overlap
	}

	resolved.Features.Discovery = boolOrDefault(input.Features.Discovery, true)
	resolved.Features.Reality = boolOrDefault(input.Features.Reality, true)
	resolved.Features.QGram = boolOrDefault(input.Features.QGram, true)
	resolved.Features.GLDR = boolOrDefault(input.Features.GLDR, true)
	resolved.Features.Raptor = boolOrDefault(input.Features.Raptor, false)

	if strings.TrimSpace(input.Persistence.Mode) != "" {
		resolved.Persistence.Mode = strings.TrimSpace(strings.ToLower(input.Persistence.Mode))
	}

	if input.GLDRConfig != nil {
		resolved.GLDRConfig = *input.GLDRConfig
		ensureGLDRDefaults(&resolved.GLDRConfig)
	}

	if input.RaptorConfig != nil {
		resolved.RaptorConfig = *input.RaptorConfig
		ensureRaptorDefaults(&resolved.RaptorConfig)
	}
	resolved.RaptorConfig.ChunkSize = resolved.Chunking.ChunkSize
	resolved.RaptorConfig.Overlap = resolved.Chunking.Overlap
	resolved.Embedder = input.EmbeddingProvider

	switch resolved.Chunking.Strategy {
	case ChunkingStrategyChunkerX2, ChunkingStrategyChapterParagraphLegacy:
	default:
		return fullSystemResolvedConfig{}, fmt.Errorf("unsupported chunking strategy %q", resolved.Chunking.Strategy)
	}

	switch resolved.Persistence.Mode {
	case PersistenceModeExplicitCommit:
	default:
		return fullSystemResolvedConfig{}, fmt.Errorf("unsupported persistence mode %q", resolved.Persistence.Mode)
	}

	if resolved.Features.Raptor && resolved.Embedder == nil {
		return fullSystemResolvedConfig{}, fmt.Errorf("features.raptor requires an embedding provider")
	}

	return resolved, nil
}

func ensureGLDRDefaults(cfg *fullsystemindex.GLDRConfig) {
	defaults := fullsystemindex.DefaultGLDRConfig()
	if cfg.TopChunks == 0 {
		cfg.TopChunks = defaults.TopChunks
	}
	if cfg.TopNodes == 0 {
		cfg.TopNodes = defaults.TopNodes
	}
	if cfg.Alpha == 0 {
		cfg.Alpha = defaults.Alpha
	}
	if cfg.Beta == 0 {
		cfg.Beta = defaults.Beta
	}
	if cfg.SoftAnchorChunks == 0 {
		cfg.SoftAnchorChunks = defaults.SoftAnchorChunks
	}
	if cfg.MaxGraphHops == 0 {
		cfg.MaxGraphHops = defaults.MaxGraphHops
	}
	if cfg.PPRDamping == 0 {
		cfg.PPRDamping = defaults.PPRDamping
	}
	if cfg.PPRIterations == 0 {
		cfg.PPRIterations = defaults.PPRIterations
	}
	if cfg.SemanticTopK == 0 {
		cfg.SemanticTopK = defaults.SemanticTopK
	}
	if cfg.SemanticAlpha == 0 {
		cfg.SemanticAlpha = defaults.SemanticAlpha
	}
	if cfg.SemanticGamma == 0 {
		cfg.SemanticGamma = defaults.SemanticGamma
	}
	if cfg.Lambda == 0 {
		cfg.Lambda = defaults.Lambda
	}
}

func ensureRaptorDefaults(cfg *raptor.RaptorConfig) {
	defaults := raptor.DefaultRaptorConfig()
	if cfg.ChunkSize == 0 {
		cfg.ChunkSize = defaults.ChunkSize
	}
	if cfg.Overlap == 0 {
		cfg.Overlap = defaults.Overlap
	}
	if cfg.MaxLevel == 0 {
		cfg.MaxLevel = defaults.MaxLevel
	}
	if cfg.ClusterMin == 0 {
		cfg.ClusterMin = defaults.ClusterMin
	}
	if cfg.SummaryMethod == "" {
		cfg.SummaryMethod = defaults.SummaryMethod
	}
	if cfg.MinRouterK == 0 {
		cfg.MinRouterK = defaults.MinRouterK
	}
}

func buildChunkerChapterSpecs(text string, chapterChunks []docchunker.Chunk) []fullSystemChapterSpec {
	if len(chapterChunks) == 0 {
		return []fullSystemChapterSpec{{
			ChapterID: 0,
			Start:     0,
			End:       len(text),
			Title:     "document",
			Text:      strings.TrimSpace(text),
		}}
	}

	sorted := append([]docchunker.Chunk{}, chapterChunks...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })

	numbered := make([]docchunker.Chunk, 0)
	for _, chunk := range sorted {
		if _, ok := extractChapterNumber(chunk.Text); ok {
			numbered = append(numbered, chunk)
		}
	}

	source := sorted
	useParsedNumber := false
	if len(numbered) > 0 {
		source = numbered
		useParsedNumber = true
	}

	specs := make([]fullSystemChapterSpec, 0, len(source)+1)
	if len(source) > 0 && source[0].Start > 0 {
		specs = append(specs, fullSystemChapterSpec{
			ChapterID: 0,
			Start:     0,
			End:       source[0].Start,
			Title:     "front_matter",
			Text:      strings.TrimSpace(text[0:source[0].Start]),
		})
	}

	nextSequentialID := uint32(1)
	for i, chunk := range source {
		chapterID := nextSequentialID
		if useParsedNumber {
			if parsed, ok := extractChapterNumber(chunk.Text); ok && parsed > 0 {
				chapterID = parsed
			}
		}
		if chapterID >= nextSequentialID {
			nextSequentialID = chapterID + 1
		} else {
			nextSequentialID++
		}

		end := len(text)
		if i+1 < len(source) {
			end = source[i+1].Start
		}

		specs = append(specs, fullSystemChapterSpec{
			ChapterID: chapterID,
			Start:     chunk.Start,
			End:       end,
			Title:     chunk.Text,
			Text:      strings.TrimSpace(text[chunk.Start:end]),
		})
	}

	return specs
}

func assignLeafToChapter(leaf docchunker.Chunk, chapters []fullSystemChapterSpec) (uint32, bool) {
	for _, chapter := range chapters {
		if leaf.Start >= chapter.Start && leaf.End <= chapter.End {
			return chapter.ChapterID, false
		}
	}

	bestChapterID := uint32(0)
	bestOverlap := -1
	for _, chapter := range chapters {
		overlap := minInt(leaf.End, chapter.End) - maxInt(leaf.Start, chapter.Start)
		if overlap > bestOverlap {
			bestOverlap = overlap
			bestChapterID = chapter.ChapterID
		}
	}

	return bestChapterID, true
}

func parseLegacyChapterRanges(text string) []fullSystemChapterSpec {
	lines := strings.SplitAfter(text, "\n")
	offset := 0

	var ranges []fullSystemChapterSpec
	var currentChapterID uint32
	var currentStart int
	var currentBody strings.Builder
	foundFirst := false

	for _, segment := range lines {
		line := strings.TrimRight(segment, "\r\n")
		if matches := legacyChapterHeaderRegex.FindStringSubmatch(line); matches != nil {
			if foundFirst {
				end := offset
				ranges = append(ranges, fullSystemChapterSpec{
					ChapterID: currentChapterID,
					Start:     currentStart,
					End:       end,
					Title:     fmt.Sprintf("Chapter %d", currentChapterID),
					Text:      strings.TrimSpace(currentBody.String()),
				})
			}

			currentChapterID = 0
			fmt.Sscanf(matches[1], "%d", &currentChapterID)
			currentBody.Reset()
			currentStart = offset + len(segment)
			foundFirst = true
			offset += len(segment)
			continue
		}

		if foundFirst {
			currentBody.WriteString(segment)
		}
		offset += len(segment)
	}

	if foundFirst {
		ranges = append(ranges, fullSystemChapterSpec{
			ChapterID: currentChapterID,
			Start:     currentStart,
			End:       len(text),
			Title:     fmt.Sprintf("Chapter %d", currentChapterID),
			Text:      strings.TrimSpace(currentBody.String()),
		})
	}

	return ranges
}

func buildParagraphLeaves(text string, baseOffset int) []LeafInput {
	paragraphs := strings.Split(text, "\n\n")
	leaves := make([]LeafInput, 0, len(paragraphs))
	offset := 0
	nextChunkID := uint32(0)

	for _, para := range paragraphs {
		if len(strings.TrimSpace(para)) == 0 {
			offset += len(para) + 2
			continue
		}
		leaves = append(leaves, LeafInput{
			ChunkID: nextChunkID,
			Text:    para,
			Start:   baseOffset + offset,
			End:     baseOffset + offset + len(para),
		})
		nextChunkID++
		offset += len(para) + 2
	}

	return leaves
}

func buildChunkMentionMap(registry *GlobalEntityRegistry) map[fullSystemChunkKey][]fullsystemindex.Mention {
	mentionsByChunk := make(map[fullSystemChunkKey][]fullsystemindex.Mention)
	if registry == nil {
		return mentionsByChunk
	}

	for _, entity := range registry.GetAllEntities() {
		for _, mention := range registry.GetMentions(entity.ID) {
			key := fullSystemChunkKey{
				ChapterID: mention.ChapterID,
				ChunkID:   mention.ChunkID,
			}
			mentionsByChunk[key] = append(mentionsByChunk[key], fullsystemindex.Mention{
				EntityID:   mention.EntityID,
				Confidence: 1.0,
				Start:      mention.Start,
				End:        mention.End,
			})
		}
	}

	return mentionsByChunk
}

func extractDiscoveryCandidates(conductor *GraptorConductor) []discovery.Candidate {
	if conductor == nil || conductor.conductor == nil {
		return nil
	}

	raw := conductor.conductor.GetCandidates()
	candidates, ok := raw.([]discovery.Candidate)
	if !ok {
		return nil
	}

	out := make([]discovery.Candidate, len(candidates))
	copy(out, candidates)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			return out[i].Token < out[j].Token
		}
		return out[i].Score > out[j].Score
	})
	return out
}

func buildStoreNote(doc *fullSystemDocument, scope FullSystemScope, now int64) *store.Note {
	return &store.Note{
		ID:              doc.NoteID,
		Version:         1,
		WorldID:         scope.WorldID,
		Title:           doc.Input.Title,
		Content:         doc.Input.Text,
		MarkdownContent: doc.Input.Text,
		FolderID:        scope.ScopeFolderID(),
		OwnerID:         "graptor",
		NarrativeID:     scope.NarrativeID,
		CreatedAt:       now,
		UpdatedAt:       now,
		ValidFrom:       now,
		IsCurrent:       true,
		ChangeReason:    "graptor_commit",
	}
}

func findEntityFirstNote(entityID string, docs map[string]*fullSystemDocument) string {
	docIDs := make([]string, 0, len(docs))
	for docID := range docs {
		docIDs = append(docIDs, docID)
	}
	sort.Strings(docIDs)

	for _, docID := range docIDs {
		doc := docs[docID]
		if doc.DocumentGraph == nil || doc.DocumentGraph.Registry == nil {
			continue
		}
		for _, entity := range doc.DocumentGraph.Registry.GetAllEntities() {
			if entity.ID == entityID {
				return doc.NoteID
			}
		}
	}
	return ""
}

func findEntityNarrativeID(entityID string, docs map[string]*fullSystemDocument) string {
	docIDs := make([]string, 0, len(docs))
	for docID := range docs {
		docIDs = append(docIDs, docID)
	}
	sort.Strings(docIDs)

	for _, docID := range docIDs {
		doc := docs[docID]
		if doc.DocumentGraph == nil || doc.DocumentGraph.Registry == nil {
			continue
		}
		for _, entity := range doc.DocumentGraph.Registry.GetAllEntities() {
			if entity.ID == entityID {
				return doc.Scope.NarrativeID
			}
		}
	}
	return ""
}

func buildQGramScope(scope *FullSystemScope) *qgram.SearchScope {
	if scope == nil {
		return nil
	}
	if strings.TrimSpace(scope.NarrativeID) == "" && strings.TrimSpace(scope.FolderPath) == "" {
		return nil
	}
	return &qgram.SearchScope{
		NarrativeID: scope.NarrativeID,
		FolderPath:  scope.FolderPath,
	}
}

func normalizeScope(base, override *FullSystemScope) FullSystemScope {
	var scope FullSystemScope
	if base != nil {
		scope = *base
	}
	if override != nil {
		if override.WorldID != "" {
			scope.WorldID = override.WorldID
		}
		if override.NarrativeID != "" {
			scope.NarrativeID = override.NarrativeID
		}
		if override.FolderID != "" {
			scope.FolderID = override.FolderID
		}
		if override.FolderPath != "" {
			scope.FolderPath = override.FolderPath
		}
	}

	scope.WorldID = strings.TrimSpace(scope.WorldID)
	scope.NarrativeID = strings.TrimSpace(scope.NarrativeID)
	scope.FolderID = strings.TrimSpace(scope.FolderID)
	scope.FolderPath = strings.TrimSpace(scope.FolderPath)

	if scope.FolderID == "" {
		switch {
		case scope.NarrativeID != "":
			scope.FolderID = scope.NarrativeID
		case scope.WorldID != "":
			scope.FolderID = scope.WorldID
		default:
			scope.FolderID = "global"
		}
	}
	if scope.FolderPath == "" {
		scope.FolderPath = scope.FolderID
	}

	return scope
}

func (s FullSystemScope) ScopeFolderID() string {
	return normalizeScope(&s, nil).FolderID
}

func (s SeedEntity) toRegisteredEntity() implicitmatcher.RegisteredEntity {
	kind := s.Kind
	if kind == nil {
		kind = implicitmatcher.KindOther
	}
	return implicitmatcher.RegisteredEntity{
		ID:          s.ID,
		Label:       s.Label,
		Aliases:     append([]string{}, s.Aliases...),
		Kind:        kind,
		NarrativeID: s.NarrativeID,
	}
}

func seedKey(seed implicitmatcher.RegisteredEntity) string {
	if strings.TrimSpace(seed.ID) != "" {
		return "id:" + strings.TrimSpace(seed.ID)
	}
	return "label:" + strings.ToLower(strings.TrimSpace(seed.Label))
}

func normalizeDocumentID(input IngestDocumentInput) string {
	if id := strings.TrimSpace(input.DocumentID); id != "" {
		return id
	}
	if title := strings.TrimSpace(input.Title); title != "" {
		return "doc:" + stableID(title)[:12]
	}
	return "doc:" + stableID(input.Text)[:12]
}

func makeSearchChunkID(docID string, chapterID, chunkID uint32, start, end int) string {
	return fmt.Sprintf("%s:%d:%d:%d-%d", docID, chapterID, chunkID, start, end)
}

func extractChapterNumber(header string) (uint32, bool) {
	matches := numberedChapterRegex.FindStringSubmatch(strings.TrimSpace(header))
	if matches == nil {
		return 0, false
	}
	var number uint32
	fmt.Sscanf(matches[1], "%d", &number)
	return number, number > 0
}

func stableID(parts ...string) string {
	h := sha1.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(part))
		_, _ = h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func newFullSystemSessionID() string {
	return "fs_" + stableID(fmt.Sprintf("%d", time.Now().UnixNano()))[:16]
}

func sliceByOffsets(text string, start, end int) string {
	if start < 0 {
		start = 0
	}
	if end > len(text) {
		end = len(text)
	}
	if start >= end || start >= len(text) {
		return ""
	}
	return text[start:end]
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func boolPtr(value bool) *bool {
	return &value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
