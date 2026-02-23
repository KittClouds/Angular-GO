package graptor

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/kittclouds/gokitt/pkg/graph"
	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/kittclouds/gokitt/pkg/reality/builder"
	"github.com/kittclouds/gokitt/pkg/reality/projection"
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
	"github.com/kittclouds/gokitt/pkg/scanner/conductor"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
	"github.com/kittclouds/gokitt/pkg/scanner/syntax"
)

// LeafProcessor processes a single leaf (text chunk) and returns results.
type LeafProcessor interface {
	ProcessLeaf(text string, chapterID uint32) *LeafResult
}

// LeafResult contains the result of processing a single leaf.
type LeafResult struct {
	Text         string
	Entities     []EntityMatch
	Tokens       []chunker.Token
	Chunks       []chunker.Chunk
	Narrative    []NarrativeEvent
	ResolvedRefs []ResolvedReference
	LeafGraph    *graph.ConceptGraph
}

// EntityMatch represents a matched entity in text.
type EntityMatch struct {
	ID      string
	Text    string
	Kind    EntityKind
	Start   int
	End     int
	Chapter uint32
}

// NarrativeEvent represents a narrative event extracted from text.
type NarrativeEvent struct {
	Event    string
	Relation string
	Subject  string
	Object   string
	Start    int
	End      int
}

// ResolvedReference represents a resolved pronoun or reference.
type ResolvedReference struct {
	Text     string
	EntityID string
	Start    int
	End      int
}

// DocumentGraph is the final output containing all chapter graphs and cross-chapter edges.
type DocumentGraph struct {
	mu sync.RWMutex

	DocumentID        string
	Chapters          map[uint32]*ChapterGraph
	CrossChapterEdges []*CrossChapterEdge
	Registry          *GlobalEntityRegistry
	Cooccurrence      *CooccurrenceStats
	Stats             DocumentStats
	CreatedAt         int64
}

// ChapterGraph contains the graph for a single chapter.
type ChapterGraph struct {
	ChapterID   uint32
	Graph       *graph.ConceptGraph
	EntityCount int
	EdgeCount   int
	LeafCount   int
}

// CrossChapterEdge represents an edge between entities in different chapters.
type CrossChapterEdge struct {
	SourceID      string
	TargetID      string
	RelationType  string
	SourceChapter uint32
	TargetChapter uint32
	Confidence    float64
	Evidence      string
}

// DocumentStats contains statistics about the processed document.
type DocumentStats struct {
	TotalChapters     int
	TotalLeaves       int
	TotalEntities     int
	TotalMentions     int
	TotalEdges        int
	CrossChapterLinks int
	ProcessingTime    int64 // milliseconds
}

// Dispose releases all resources held by the DocumentGraph.
// Call this when the graph is no longer needed to allow garbage collection.
func (dg *DocumentGraph) Dispose() {
	dg.mu.Lock()
	defer dg.mu.Unlock()

	// Clear registry if present
	if dg.Registry != nil {
		dg.Registry.Clear()
		dg.Registry = nil
	}

	// Clear co-occurrence stats
	if dg.Cooccurrence != nil {
		dg.Cooccurrence.Clear()
		dg.Cooccurrence = nil
	}

	// Clear chapter graphs
	for _, cg := range dg.Chapters {
		if cg != nil {
			cg.Graph = nil
		}
	}
	dg.Chapters = nil

	// Clear cross-chapter edges
	dg.CrossChapterEdges = nil
}

// GraptorConductor orchestrates the full document ingestion pipeline.
// It processes documents chapter by chapter, maintaining cross-chapter entity context.
type GraptorConductor struct {
	registry       *GlobalEntityRegistry
	chapterManager *ChapterManager
	narrative      *narrative.NarrativeMatcher
	chunker        *chunker.Chunker
	conductor      *conductor.Conductor

	// Co-occurrence tracking
	cooccurrence *CooccurrenceStats

	// Alias detection
	aliasDetector *AliasDetector

	// Configuration
	config *ConductorConfig

	// Processing state
	currentDocument *DocumentGraph

	// Dictionary entity mapping (dictionary ID -> registry ID)
	dictEntityMap map[string]string
}

// ConductorConfig holds configuration for GraptorConductor.
type ConductorConfig struct {
	MaxHistory     int
	CarryOverSize  int
	RegistryConfig *RegistryConfig
	ChapterConfig  *ChapterContextConfig
}

// DefaultConductorConfig returns default configuration.
func DefaultConductorConfig() *ConductorConfig {
	return &ConductorConfig{
		MaxHistory:     100,
		CarryOverSize:  10,
		RegistryConfig: DefaultRegistryConfig(),
		ChapterConfig:  DefaultChapterContextConfig(),
	}
}

// NewGraptorConductor creates a new Graptor conductor.
func NewGraptorConductor(config *ConductorConfig) (*GraptorConductor, error) {
	if config == nil {
		config = DefaultConductorConfig()
	}

	// Initialize narrative matcher
	nm, err := narrative.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create narrative matcher: %w", err)
	}

	// Initialize conductor
	cond, err := conductor.New()
	if err != nil {
		return nil, fmt.Errorf("failed to create conductor: %w", err)
	}

	// Initialize registry
	registry := NewGlobalEntityRegistry(config.RegistryConfig)

	// Initialize chapter manager
	chapterManager := NewChapterManager(registry, config.ChapterConfig)

	return &GraptorConductor{
		registry:       registry,
		chapterManager: chapterManager,
		narrative:      nm,
		chunker:        chunker.New(),
		conductor:      cond,
		cooccurrence:   NewCooccurrenceStats(3), // 3-sentence window
		aliasDetector:  NewAliasDetector(),
		config:         config,
		dictEntityMap:  make(map[string]string),
	}, nil
}

// IngestDocument processes a full document and returns the document graph.
func (gc *GraptorConductor) IngestDocument(docID, text string, chapters []ChapterInput) (*DocumentGraph, error) {
	startTime := time.Now()

	// Initialize document graph
	docGraph := &DocumentGraph{
		DocumentID:        docID,
		Chapters:          make(map[uint32]*ChapterGraph),
		CrossChapterEdges: make([]*CrossChapterEdge, 0),
		Registry:          gc.registry,
		Cooccurrence:      gc.cooccurrence,
		CreatedAt:         startTime.Unix(),
	}
	gc.currentDocument = docGraph

	// Process each chapter
	for _, chapter := range chapters {
		gc.processChapter(chapter, docGraph)
	}

	// Finalize all chapters
	gc.chapterManager.FinishDocument()

	// Build cross-chapter edges
	gc.buildCrossChapterEdges(docGraph)

	// Calculate stats
	docGraph.Stats = DocumentStats{
		TotalChapters:     len(chapters),
		TotalLeaves:       gc.countTotalLeaves(docGraph),
		TotalEntities:     gc.registry.Stats().TotalEntities,
		TotalMentions:     gc.registry.Stats().TotalMentions,
		TotalEdges:        gc.countTotalEdges(docGraph),
		CrossChapterLinks: len(docGraph.CrossChapterEdges),
		ProcessingTime:    time.Since(startTime).Milliseconds(),
	}

	return docGraph, nil
}

// ChapterInput represents input for a single chapter.
type ChapterInput struct {
	ChapterID uint32
	Text      string
	Leaves    []LeafInput // Optional: if nil, will split by paragraphs
}

// LeafInput represents input for a single leaf within a chapter.
type LeafInput struct {
	ChunkID uint32
	Text    string
	Start   int
	End     int
}

// processChapter processes a single chapter.
func (gc *GraptorConductor) processChapter(chapter ChapterInput, docGraph *DocumentGraph) {
	// Start chapter context
	ctx := gc.chapterManager.StartChapter(chapter.ChapterID)

	// Get leaves
	leaves := chapter.Leaves
	if leaves == nil {
		// Split by paragraphs
		leaves = gc.splitIntoLeaves(chapter.Text, chapter.ChapterID)
	}

	// Process each leaf
	chapterGraph := &ChapterGraph{
		ChapterID: chapter.ChapterID,
		Graph:     graph.NewGraph(),
		LeafCount: len(leaves),
	}

	for _, leaf := range leaves {
		leafResult := gc.processLeaf(leaf, chapter.ChapterID, ctx)

		// Merge leaf graph into chapter graph
		if leafResult.LeafGraph != nil {
			gc.mergeLeafGraph(chapterGraph.Graph, leafResult.LeafGraph)
		}
	}

	// Update stats
	chapterGraph.EntityCount = len(gc.registry.GetChapterEntities(chapter.ChapterID))
	chapterGraph.EdgeCount = len(chapterGraph.Graph.AllEdges())

	docGraph.mu.Lock()
	docGraph.Chapters[chapter.ChapterID] = chapterGraph
	docGraph.mu.Unlock()
}

// processLeaf processes a single leaf and returns results.
func (gc *GraptorConductor) processLeaf(leaf LeafInput, chapterID uint32, ctx *ChapterContext) *LeafResult {
	result := &LeafResult{
		Text: leaf.Text,
	}

	// Run conductor scan
	scanResult := gc.conductor.Scan(leaf.Text)
	result.Tokens = scanResult.Tokens
	result.Chunks = scanResult.Chunks

	// Extract entities from scan result
	entities := gc.extractEntities(scanResult, chapterID)
	result.Entities = entities

	// Register entities in registry and chapter context
	for _, entity := range entities {
		mention := &EntityMention{
			EntityID:  entity.ID,
			Text:      entity.Text,
			ChapterID: chapterID,
			ChunkID:   leaf.ChunkID,
			Start:     entity.Start,
			End:       entity.End,
		}
		ctx.ObserveMention(entity.ID, mention)
	}

	// Track co-occurrences for entities in this leaf
	if len(entities) >= 2 {
		entityIDs := make([]string, len(entities))
		for i, e := range entities {
			entityIDs[i] = e.ID
		}
		gc.cooccurrence.RecordCooccurrence(entityIDs, chapterID)
	}

	// Detect and register aliases
	gc.detectAndRegisterAliases(leaf.Text, chapterID)

	// Build CST
	cst := builder.Zip(leaf.Text, scanResult)

	// Build entity map for projection
	entityMap := gc.buildEntityMap(entities)
	result.LeafGraph = projection.Project(cst, gc.narrative, entityMap, leaf.Text, nil)

	// Extract narrative events
	result.Narrative = gc.extractNarrativeEvents(scanResult)

	// Resolve pronouns
	result.ResolvedRefs = gc.resolvePronouns(scanResult, chapterID, ctx)

	return result
}

// extractEntities extracts entities from a scan result.
func (gc *GraptorConductor) extractEntities(scanResult conductor.ScanResult, chapterID uint32) []EntityMatch {
	var entities []EntityMatch

	for _, sm := range scanResult.Syntax {
		// Check if entity already exists in registry
		entity := gc.registry.Lookup(sm.Text)
		var id string
		var kind EntityKind

		if entity != nil {
			// Entity exists - update chapter tracking via RegisterMention
			id = entity.ID
			kind = entity.Kind
			// This will update chapter tracking if this entity appears in a new chapter
			gc.registry.RegisterMention(sm.Text, kind, chapterID, uint32(sm.Start), sm.Start, sm.End)
		} else {
			// Check if this entity has a dictionary ID (from seeded entities)
			if dictID := sm.ID; dictID != "" {
				if registryID, ok := gc.dictEntityMap[dictID]; ok {
					// Use the seeded registry ID
					id = registryID
					kind = gc.inferKindFromSyntax(sm)
					// Update chapter tracking for this entity
					gc.registry.RegisterMention(sm.Text, kind, chapterID, uint32(sm.Start), sm.Start, sm.End)
				} else {
					// Register new entity
					kind = gc.inferKindFromSyntax(sm)
					id = gc.registry.Register(sm.Text, kind, GenderUnknown, chapterID, uint32(sm.Start))
				}
			} else {
				// Register new entity
				kind = gc.inferKindFromSyntax(sm)
				id = gc.registry.Register(sm.Text, kind, GenderUnknown, chapterID, uint32(sm.Start))
			}
		}

		entities = append(entities, EntityMatch{
			ID:      id,
			Text:    sm.Text,
			Kind:    kind,
			Start:   sm.Start,
			End:     sm.End,
			Chapter: chapterID,
		})
	}

	return entities
}

// inferKindFromSyntax infers entity kind from syntax match.
func (gc *GraptorConductor) inferKindFromSyntax(sm syntax.SyntaxMatch) EntityKind {
	switch strings.ToLower(sm.EntityKind) {
	case "person", "character":
		return KindPerson
	case "location", "place":
		return KindLocation
	case "organization", "group":
		return KindOrganization
	case "object", "item":
		return KindObject
	default:
		return KindUnknown
	}
}

// buildEntityMap creates an EntityMap for the projector.
func (gc *GraptorConductor) buildEntityMap(entities []EntityMatch) projection.EntityMap {
	m := make(projection.EntityMap)
	for _, e := range entities {
		m[e.Start] = e.ID
	}
	return m
}

// extractNarrativeEvents extracts narrative events from scan result.
func (gc *GraptorConductor) extractNarrativeEvents(scanResult conductor.ScanResult) []NarrativeEvent {
	var events []NarrativeEvent

	for _, ne := range scanResult.Narrative {
		events = append(events, NarrativeEvent{
			Event:    ne.Event.String(),
			Relation: ne.Relation.String(),
			Subject:  ne.Subject,
			Object:   ne.Object,
			Start:    ne.Range.Start,
			End:      ne.Range.End,
		})
	}

	return events
}

// resolvePronouns resolves pronouns in text.
func (gc *GraptorConductor) resolvePronouns(scanResult conductor.ScanResult, chapterID uint32, _ *ChapterContext) []ResolvedReference {
	var refs []ResolvedReference

	// Get transition for chapter boundary resolution
	transition := gc.chapterManager.CreateTransition(chapterID)

	for _, ref := range scanResult.ResolvedRefs {
		// Try to resolve using chapter context if not already resolved
		entityID := ref.EntityID
		if entityID == "" || entityID == ref.Text {
			entityID = transition.ResolvePronoun(ref.Text)
		}

		if entityID != "" {
			refs = append(refs, ResolvedReference{
				Text:     ref.Text,
				EntityID: entityID,
				Start:    ref.Range.Start,
				End:      ref.Range.End,
			})
		}
	}

	return refs
}

// splitIntoLeaves splits text into leaves (paragraphs).
func (gc *GraptorConductor) splitIntoLeaves(text string, _ uint32) []LeafInput {
	var leaves []LeafInput

	paragraphs := strings.Split(text, "\n\n")
	offset := 0
	for i, para := range paragraphs {
		if len(strings.TrimSpace(para)) == 0 {
			offset += len(para) + 2 // +2 for "\n\n"
			continue
		}

		leaves = append(leaves, LeafInput{
			ChunkID: uint32(i),
			Text:    para,
			Start:   offset,
			End:     offset + len(para),
		})
		offset += len(para) + 2
	}

	return leaves
}

// mergeLeafGraph merges a leaf graph into a chapter graph.
func (gc *GraptorConductor) mergeLeafGraph(chapterGraph, leafGraph *graph.ConceptGraph) {
	// Merge nodes
	for _, node := range leafGraph.AllNodes() {
		chapterGraph.EnsureNode(node.ID, node.Label, node.Kind)
	}

	// Merge edges
	for _, edge := range leafGraph.AllEdges() {
		// Get or create nodes
		source := chapterGraph.EnsureNode(edge.Source.ID, edge.Source.Label, edge.Source.Kind)
		target := chapterGraph.EnsureNode(edge.Target.ID, edge.Target.Label, edge.Target.Kind)

		// Create edge
		newEdge := &graph.ConceptEdge{
			Relation:   edge.Edge.Relation,
			Weight:     edge.Edge.Weight,
			Source:     source,
			Target:     target,
			Manner:     edge.Edge.Manner,
			Location:   edge.Edge.Location,
			Time:       edge.Edge.Time,
			Recipient:  edge.Edge.Recipient,
			SourceDoc:  edge.Edge.SourceDoc,
			SourceSpan: edge.Edge.SourceSpan,
		}
		source.Outbound = append(source.Outbound, newEdge)
		target.Inbound = append(target.Inbound, newEdge)
	}
}

// buildCrossChapterEdges builds edges between entities across chapters.
func (gc *GraptorConductor) buildCrossChapterEdges(docGraph *DocumentGraph) {
	// Get all entities with their chapters
	allEntities := gc.registry.GetAllEntities()

	for _, entity := range allEntities {
		if len(entity.Chapters) < 2 {
			continue // Entity only appears in one chapter
		}

		// Create cross-chapter links for entities appearing in multiple chapters
		for i := 0; i < len(entity.Chapters)-1; i++ {
			docGraph.CrossChapterEdges = append(docGraph.CrossChapterEdges, &CrossChapterEdge{
				SourceID:      entity.ID,
				TargetID:      entity.ID,
				RelationType:  "SAME_AS",
				SourceChapter: entity.Chapters[i],
				TargetChapter: entity.Chapters[i+1],
				Confidence:    1.0,
				Evidence:      fmt.Sprintf("Entity '%s' appears in chapters %d and %d", entity.CanonicalName, entity.Chapters[i], entity.Chapters[i+1]),
			})
		}
	}

	// Add alias-based cross-chapter edges
	for _, entity := range allEntities {
		for _, alias := range entity.Aliases {
			if alias == entity.CanonicalName {
				continue
			}
			// Check if alias is also an entity
			aliasEntity := gc.registry.Lookup(alias)
			if aliasEntity != nil && aliasEntity.ID != entity.ID {
				docGraph.CrossChapterEdges = append(docGraph.CrossChapterEdges, &CrossChapterEdge{
					SourceID:      entity.ID,
					TargetID:      aliasEntity.ID,
					RelationType:  "ALIAS_OF",
					SourceChapter: entity.FirstChapter,
					TargetChapter: aliasEntity.FirstChapter,
					Confidence:    0.9,
					Evidence:      fmt.Sprintf("'%s' is an alias of '%s'", alias, entity.CanonicalName),
				})
			}
		}
	}
}

// countTotalLeaves counts total leaves in document.
func (gc *GraptorConductor) countTotalLeaves(docGraph *DocumentGraph) int {
	total := 0
	for _, chapter := range docGraph.Chapters {
		total += chapter.LeafCount
	}
	return total
}

// countTotalEdges counts total edges in document.
func (gc *GraptorConductor) countTotalEdges(docGraph *DocumentGraph) int {
	total := 0
	for _, chapter := range docGraph.Chapters {
		total += chapter.EdgeCount
	}
	return total
}

// GetRegistry returns the global entity registry.
func (gc *GraptorConductor) GetRegistry() *GlobalEntityRegistry {
	return gc.registry
}

// GetChapterManager returns the chapter manager.
func (gc *GraptorConductor) GetChapterManager() *ChapterManager {
	return gc.chapterManager
}

// GetCooccurrence returns the co-occurrence statistics.
func (gc *GraptorConductor) GetCooccurrence() *CooccurrenceStats {
	return gc.cooccurrence
}

// GetRelatedEntities returns entities related to the given entity by co-occurrence.
func (gc *GraptorConductor) GetRelatedEntities(entityID string, minCount int) []RelatedEntity {
	return gc.cooccurrence.GetRelated(entityID, minCount)
}

// detectAndRegisterAliases detects alias patterns in text and registers them.
func (gc *GraptorConductor) detectAndRegisterAliases(text string, chapterID uint32) {
	// Detect aliases using context-aware detection
	aliases := gc.aliasDetector.DetectAliasesInContext(text, gc.registry)

	for _, alias := range aliases {
		// Determine which entity is known and which is new
		var knownID, newName string

		if alias.KnownEntity != "" {
			// We have a known entity
			knownID = alias.KnownEntity
			if alias.Entity1 == alias.KnownEntity {
				newName = alias.Entity2
			} else {
				newName = alias.Entity1
			}
		} else {
			// Neither is known - check if either matches an existing entity
			entity1 := gc.registry.Lookup(alias.Entity1)
			entity2 := gc.registry.Lookup(alias.Entity2)

			if entity1 != nil && entity2 == nil {
				knownID = entity1.ID
				newName = alias.Entity2
			} else if entity2 != nil && entity1 == nil {
				knownID = entity2.ID
				newName = alias.Entity1
			} else if entity1 != nil && entity2 != nil {
				// Both exist - link them as aliases
				gc.registry.AddAlias(entity1.ID, alias.Entity2)
				gc.registry.AddAlias(entity2.ID, alias.Entity1)
				continue
			} else {
				// Neither exists - register the primary name and add the other as alias
				// Use Entity1 as primary (usually the full name)
				knownID = gc.registry.Register(alias.Entity1, KindPerson, GenderUnknown, chapterID, 0)
				newName = alias.Entity2
			}
		}

		// Add the alias to the known entity
		if knownID != "" && newName != "" {
			gc.registry.AddAlias(knownID, newName)
		}
	}
}

// SetDictionary sets the implicit matcher dictionary for entity recognition.
func (gc *GraptorConductor) SetDictionary(dict *implicitmatcher.RuntimeDictionary) {
	gc.conductor.SetDictionary(dict)
}

// SeedRegistry seeds the GlobalEntityRegistry with known entities for cross-chapter tracking.
// This should be called with the same entities used to compile the dictionary.
func (gc *GraptorConductor) SeedRegistry(entities []implicitmatcher.RegisteredEntity) {
	for _, entity := range entities {
		// Convert kind
		kind := convertImplicitKindToEntityKind(entity.Kind)

		// Register in our registry with the dictionary ID
		registryID := gc.registry.RegisterWithID(entity.Label, entity.ID, kind, GenderUnknown, 0, 0)

		// Store mapping from dictionary ID to registry ID
		gc.dictEntityMap[entity.ID] = registryID

		// Add aliases
		for _, alias := range entity.Aliases {
			gc.registry.AddAlias(registryID, alias)
		}
	}
}

// convertImplicitKindToEntityKind converts implicitmatcher.EntityKind to graptor.EntityKind.
func convertImplicitKindToEntityKind(kind interface{}) EntityKind {
	switch v := kind.(type) {
	case implicitmatcher.EntityKind:
		switch v {
		case implicitmatcher.KindCharacter:
			return KindPerson
		case implicitmatcher.KindPlace:
			return KindLocation
		case implicitmatcher.KindFaction, implicitmatcher.KindOrganization:
			return KindOrganization
		case implicitmatcher.KindItem:
			return KindObject
		default:
			return KindUnknown
		}
	case string:
		switch v {
		case "Character", "Person":
			return KindPerson
		case "Place", "Location":
			return KindLocation
		case "Faction", "Organization":
			return KindOrganization
		case "Item", "Object":
			return KindObject
		default:
			return KindUnknown
		}
	default:
		return KindUnknown
	}
}

// SeedDiscovery seeds the discovery engine with known entities.
func (gc *GraptorConductor) SeedDiscovery(entities []implicitmatcher.RegisteredEntity) {
	gc.conductor.SeedDiscovery(entities)
}

// RegisterKnownEntity registers a known entity before processing.
func (gc *GraptorConductor) RegisterKnownEntity(name string, kind EntityKind, gender Gender, aliases []string) string {
	id := gc.registry.Register(name, kind, gender, 0, 0)
	for _, alias := range aliases {
		gc.registry.AddAlias(id, alias)
	}
	return id
}

// Export exports the current document state.
func (gc *GraptorConductor) Export() *ExportedDocument {
	if gc.currentDocument == nil {
		return nil
	}
	return &ExportedDocument{
		Registry: gc.registry.Export(),
		Stats:    gc.currentDocument.Stats,
	}
}

// ExportedDocument is a serializable document state.
type ExportedDocument struct {
	Registry *ExportedRegistry `json:"registry"`
	Stats    DocumentStats     `json:"stats"`
}

// Import loads a previously exported document state.
func (gc *GraptorConductor) Import(export *ExportedDocument) {
	gc.registry.Import(export.Registry)
}
