//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"github.com/kittclouds/gokitt/pkg/gldr"
)

var gldrIndex *gldr.GLDRIndex

type gldrMentionInput struct {
	EntityID string `json:"entityId"`
	Count    int    `json:"count"`
}

type gldrEdgeInput struct {
	TargetID   string  `json:"targetId"`
	RelType    string  `json:"relType"`
	Confidence float64 `json:"confidence"`
	Source     string  `json:"source"`
}

type gldrChunkBatchInput struct {
	ChunkID  string             `json:"chunkId"`
	Fields   map[string]string  `json:"fields"`
	Mentions []gldrMentionInput `json:"mentions"`
}

type gldrConfigInput struct {
	Alpha            float64 `json:"alpha"`
	Beta             float64 `json:"beta"`
	MaxGraphHops     int     `json:"maxGraphHops"`
	SoftAnchorChunks int     `json:"softAnchorChunks"`
	TopChunks        int     `json:"topChunks"`
	TopNodes         int     `json:"topNodes"`
	Lambda           float64 `json:"lambda"`
	PPRDamping       float64 `json:"pprDamping"`
	PPRIterations    int     `json:"pprIterations"`
	SemanticTopK     int     `json:"semanticTopK"`
	SemanticAlpha    float64 `json:"semanticAlpha"`
	SemanticGamma    float64 `json:"semanticGamma"`
}

func applyGLDRConfig(config *gldr.GLDRConfig, cfg gldrConfigInput) {
	if cfg.Alpha > 0 {
		config.Alpha = cfg.Alpha
	}
	if cfg.Beta > 0 {
		config.Beta = cfg.Beta
	}
	if cfg.MaxGraphHops > 0 {
		config.MaxGraphHops = cfg.MaxGraphHops
	}
	if cfg.SoftAnchorChunks > 0 {
		config.SoftAnchorChunks = cfg.SoftAnchorChunks
	}
	if cfg.TopChunks > 0 {
		config.TopChunks = cfg.TopChunks
	}
	if cfg.TopNodes > 0 {
		config.TopNodes = cfg.TopNodes
	}
	if cfg.Lambda > 0 {
		config.Lambda = cfg.Lambda
	}
	if cfg.PPRDamping > 0 {
		config.PPRDamping = cfg.PPRDamping
	}
	if cfg.PPRIterations > 0 {
		config.PPRIterations = cfg.PPRIterations
	}
	if cfg.SemanticTopK > 0 {
		config.SemanticTopK = cfg.SemanticTopK
		config.SemanticConfig.K = cfg.SemanticTopK
	}
	if cfg.SemanticAlpha > 0 {
		config.SemanticAlpha = cfg.SemanticAlpha
		config.SemanticConfig.ScoreConfig.Alpha = cfg.SemanticAlpha
	}
	if cfg.SemanticGamma > 0 {
		config.SemanticGamma = cfg.SemanticGamma
	}
}

func parseGLDRFields(raw string) (map[string]string, error) {
	fields := make(map[string]string)
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func toEntityMentions(inputMentions []gldrMentionInput) []gldr.EntityMention {
	mentions := make([]gldr.EntityMention, 0)
	for _, item := range inputMentions {
		if item.EntityID == "" || item.Count <= 0 {
			continue
		}
		for i := 0; i < item.Count; i++ {
			mentions = append(mentions, gldr.EntityMention{
				EntityID:   item.EntityID,
				Confidence: 1.0,
			})
		}
	}
	return mentions
}

func parseGLDRMentions(raw string) ([]gldr.EntityMention, error) {
	var inputMentions []gldrMentionInput
	if raw == "" || raw == "null" {
		return nil, nil
	}
	if err := json.Unmarshal([]byte(raw), &inputMentions); err != nil {
		return nil, err
	}
	return toEntityMentions(inputMentions), nil
}

func readSABEmbedding(expectedCount, expectedDim int) ([]float32, int, int, error) {
	if sharedBuffer == nil {
		return nil, 0, 0, fmt.Errorf("SharedArrayBuffer not initialized - call sabInit first")
	}

	embeddings, count, dim := sharedBuffer.ReadEmbeddings()
	if embeddings == nil || count == 0 || dim == 0 {
		return nil, count, dim, fmt.Errorf("failed to read embeddings from SAB")
	}
	if expectedCount > 0 && count != expectedCount {
		return nil, count, dim, fmt.Errorf("SAB count mismatch: expected %d got %d", expectedCount, count)
	}
	if expectedDim > 0 && dim != expectedDim {
		return nil, count, dim, fmt.Errorf("SAB dim mismatch: expected %d got %d", expectedDim, dim)
	}
	if len(embeddings) == 0 || len(embeddings[0]) == 0 {
		return nil, count, dim, fmt.Errorf("SAB returned empty embedding payload")
	}

	return embeddings[0], count, dim, nil
}

func gldrInit(this js.Value, args []js.Value) interface{} {
	config := gldr.DefaultGLDRConfig()

	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		var cfg gldrConfigInput
		if err := json.Unmarshal([]byte(args[0].String()), &cfg); err == nil {
			applyGLDRConfig(&config, cfg)
		}
	}

	gldrIndex = gldr.NewGLDR(config)
	return SuccessResult("gldr initialized")
}

func gldrRegisterEntity(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 2 {
		return ErrorResult("requires 2 args: name, entityID")
	}

	name := strings.TrimSpace(args[0].String())
	entityID := strings.TrimSpace(args[1].String())
	if name == "" || entityID == "" {
		return ErrorResult("name and entityID are required")
	}

	gldrIndex.RegisterEntity(name, entityID)
	return SuccessResult("entity registered")
}

func gldrIndexChunk(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("requires 3 args: chunkId, fieldsJSON, mentionsJSON")
	}

	chunkID := strings.TrimSpace(args[0].String())
	if chunkID == "" {
		return ErrorResult("chunkId is required")
	}

	fields, err := parseGLDRFields(args[1].String())
	if err != nil {
		return ErrorResult("invalid fields json: " + err.Error())
	}
	mentions, err := parseGLDRMentions(args[2].String())
	if err != nil {
		return ErrorResult("invalid mentions json: " + err.Error())
	}

	gldrIndex.IndexChunk(chunkID, fields, mentions)
	return SuccessResult(fmt.Sprintf("indexed %s", chunkID))
}

func gldrIndexChunkSAB(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 5 {
		return ErrorResult("requires 5 args: chunkId, fieldsJSON, mentionsJSON, count, dim")
	}

	chunkID := strings.TrimSpace(args[0].String())
	if chunkID == "" {
		return ErrorResult("chunkId is required")
	}

	fields, err := parseGLDRFields(args[1].String())
	if err != nil {
		return ErrorResult("invalid fields json: " + err.Error())
	}
	mentions, err := parseGLDRMentions(args[2].String())
	if err != nil {
		return ErrorResult("invalid mentions json: " + err.Error())
	}

	expectedCount := args[3].Int()
	expectedDim := args[4].Int()
	vec, count, dim, err := readSABEmbedding(expectedCount, expectedDim)
	if err != nil {
		return ErrorResult(err.Error())
	}

	gldrIndex.IndexChunkWithVector(chunkID, fields, mentions, vec)

	result := map[string]interface{}{
		"success": true,
		"count":   count,
		"dim":     dim,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}

func gldrIndexChunksSAB(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 3 {
		return ErrorResult("requires 3 args: itemsJSON, count, dim")
	}
	var items []gldrChunkBatchInput
	if err := json.Unmarshal([]byte(args[0].String()), &items); err != nil {
		return ErrorResult("invalid items json: " + err.Error())
	}
	if len(items) == 0 {
		return ErrorResult("items are required")
	}
	if sharedBuffer == nil {
		return ErrorResult("SharedArrayBuffer not initialized - call sabInit first")
	}
	embeddings, count, dim := sharedBuffer.ReadEmbeddings()
	if embeddings == nil || count == 0 || dim == 0 {
		return ErrorResult("failed to read embeddings from SAB")
	}
	expectedCount := args[1].Int()
	expectedDim := args[2].Int()
	if expectedCount > 0 && count != expectedCount {
		return ErrorResult(fmt.Sprintf("SAB count mismatch: expected %d got %d", expectedCount, count))
	}
	if expectedDim > 0 && dim != expectedDim {
		return ErrorResult(fmt.Sprintf("SAB dim mismatch: expected %d got %d", expectedDim, dim))
	}
	if len(items) != count {
		return ErrorResult(fmt.Sprintf("item count mismatch: %d items for %d embeddings", len(items), count))
	}
	for i, item := range items {
		chunkID := strings.TrimSpace(item.ChunkID)
		if chunkID == "" {
			return ErrorResult(fmt.Sprintf("chunkId is required for item %d", i))
		}
		gldrIndex.IndexChunkWithVector(chunkID, item.Fields, toEntityMentions(item.Mentions), embeddings[i])
	}
	result := map[string]interface{}{
		"success": true,
		"count":   count,
		"dim":     dim,
	}
	jsonBytes, _ := json.Marshal(result)
	return string(jsonBytes)
}
func gldrAddGraphEdge(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}

	if len(args) < 2 {
		return ErrorResult("requires 2 args: sourceID, edgeJSON")
	}

	sourceID := strings.TrimSpace(args[0].String())
	if sourceID == "" {
		return ErrorResult("sourceID is required")
	}

	var input gldrEdgeInput
	if err := json.Unmarshal([]byte(args[1].String()), &input); err != nil {
		return ErrorResult("invalid edge json: " + err.Error())
	}
	if input.TargetID == "" {
		return ErrorResult("targetId is required")
	}
	if input.RelType == "" {
		input.RelType = "related_to"
	}
	if input.Confidence <= 0 {
		input.Confidence = 1.0
	}
	if input.Source == "" {
		input.Source = "scanner"
	}

	gldrIndex.AddGraphEdge(sourceID, gldr.GraphEdge{
		TargetID:   input.TargetID,
		RelType:    input.RelType,
		Confidence: input.Confidence,
		Source:     input.Source,
	})

	return SuccessResult("graph edge added")
}

func gldrLoadCooccurrences(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	return SuccessResult("cooccurrence load is handled by direct graph edge ingestion in wasm")
}

func parseGLDRConfig(raw string) gldr.GLDRConfig {
	config := gldr.DefaultGLDRConfig()
	if gldrIndex != nil {
		config = gldrIndex.Config
	}
	if raw == "" || raw == "null" {
		return config
	}

	var cfg gldrConfigInput
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return config
	}

	applyGLDRConfig(&config, cfg)
	return config
}

func gldrSearch(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: query")
	}

	query := strings.TrimSpace(args[0].String())
	if query == "" {
		return "[]"
	}

	var configRaw string
	if len(args) > 1 {
		configRaw = args[1].String()
	}

	results := gldrIndex.Search(query, parseGLDRConfig(configRaw))
	jsonBytes, _ := json.Marshal(results)
	return string(jsonBytes)
}

func gldrSearchSAB(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 4 {
		return ErrorResult("requires 4 args: query, configJSON, count, dim")
	}

	query := strings.TrimSpace(args[0].String())
	if query == "" {
		return "[]"
	}

	config := parseGLDRConfig(args[1].String())
	queryVec, _, _, err := readSABEmbedding(args[2].Int(), args[3].Int())
	if err != nil {
		return ErrorResult(err.Error())
	}

	results := gldrIndex.SearchWithVector(query, queryVec, config)
	jsonBytes, _ := json.Marshal(results)
	return string(jsonBytes)
}

func gldrSearchNodes(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 1 {
		return ErrorResult("requires 1 arg: query")
	}

	query := strings.TrimSpace(args[0].String())
	if query == "" {
		return "[]"
	}

	var configRaw string
	if len(args) > 1 {
		configRaw = args[1].String()
	}

	results := gldrIndex.SearchNodes(query, parseGLDRConfig(configRaw))
	jsonBytes, _ := json.Marshal(results)
	return string(jsonBytes)
}

func gldrSearchNodesSAB(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return ErrorResult("gldr not initialized")
	}
	if len(args) < 4 {
		return ErrorResult("requires 4 args: query, configJSON, count, dim")
	}

	query := strings.TrimSpace(args[0].String())
	if query == "" {
		return "[]"
	}

	config := parseGLDRConfig(args[1].String())
	queryVec, _, _, err := readSABEmbedding(args[2].Int(), args[3].Int())
	if err != nil {
		return ErrorResult(err.Error())
	}

	results := gldrIndex.SearchNodesWithVector(query, queryVec, config)
	jsonBytes, _ := json.Marshal(results)
	return string(jsonBytes)
}

func gldrStats(this js.Value, args []js.Value) interface{} {
	if gldrIndex == nil {
		return `{"entities":0,"chunks":0,"edges":0}`
	}

	stats := map[string]int{
		"entities": gldrIndex.GetEntityCount(),
		"chunks":   gldrIndex.Len(),
		"edges":    gldrIndex.GetEdgeCount(),
	}
	jsonBytes, _ := json.Marshal(stats)
	return string(jsonBytes)
}
