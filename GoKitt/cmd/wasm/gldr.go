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

func gldrInit(this js.Value, args []js.Value) interface{} {
	config := gldr.DefaultGLDRConfig()

	if len(args) > 0 && args[0].String() != "" && args[0].String() != "null" {
		var cfg struct {
			Alpha         float64 `json:"alpha"`
			Beta          float64 `json:"beta"`
			MaxGraphHops  int     `json:"maxGraphHops"`
			SoftAnchors   int     `json:"softAnchorChunks"`
			TopChunks     int     `json:"topChunks"`
			TopNodes      int     `json:"topNodes"`
			Lambda        float64 `json:"lambda"`
			PPRIterations int     `json:"pprIterations"`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &cfg); err == nil {
			if cfg.Alpha > 0 {
				config.Alpha = cfg.Alpha
			}
			if cfg.Beta > 0 {
				config.Beta = cfg.Beta
			}
			if cfg.MaxGraphHops > 0 {
				config.MaxGraphHops = cfg.MaxGraphHops
			}
			if cfg.SoftAnchors > 0 {
				config.SoftAnchorChunks = cfg.SoftAnchors
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
			if cfg.PPRIterations > 0 {
				config.PPRIterations = cfg.PPRIterations
			}
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

	fields := make(map[string]string)
	if err := json.Unmarshal([]byte(args[1].String()), &fields); err != nil {
		return ErrorResult("invalid fields json: " + err.Error())
	}

	var inputMentions []gldrMentionInput
	if raw := args[2].String(); raw != "" && raw != "null" {
		if err := json.Unmarshal([]byte(raw), &inputMentions); err != nil {
			return ErrorResult("invalid mentions json: " + err.Error())
		}
	}

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

	gldrIndex.IndexChunk(chunkID, fields, mentions)
	return SuccessResult(fmt.Sprintf("indexed %s", chunkID))
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

	var cfg struct {
		Alpha            float64 `json:"alpha"`
		Beta             float64 `json:"beta"`
		MaxGraphHops     int     `json:"maxGraphHops"`
		PPRDamping       float64 `json:"pprDamping"`
		PPRIterations    int     `json:"pprIterations"`
		SoftAnchorChunks int     `json:"softAnchorChunks"`
		Lambda           float64 `json:"lambda"`
		TopChunks        int     `json:"topChunks"`
		TopNodes         int     `json:"topNodes"`
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return config
	}

	if cfg.Alpha > 0 {
		config.Alpha = cfg.Alpha
	}
	if cfg.Beta > 0 {
		config.Beta = cfg.Beta
	}
	if cfg.MaxGraphHops > 0 {
		config.MaxGraphHops = cfg.MaxGraphHops
	}
	if cfg.PPRDamping > 0 {
		config.PPRDamping = cfg.PPRDamping
	}
	if cfg.PPRIterations > 0 {
		config.PPRIterations = cfg.PPRIterations
	}
	if cfg.SoftAnchorChunks > 0 {
		config.SoftAnchorChunks = cfg.SoftAnchorChunks
	}
	if cfg.Lambda > 0 {
		config.Lambda = cfg.Lambda
	}
	if cfg.TopChunks > 0 {
		config.TopChunks = cfg.TopChunks
	}
	if cfg.TopNodes > 0 {
		config.TopNodes = cfg.TopNodes
	}

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
