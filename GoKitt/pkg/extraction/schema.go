package extraction

import (
	"encoding/json"

	"github.com/kittclouds/gokitt/pkg/batch"
)

func StructuredRequestOptions() *batch.RequestOptions {
	schema, _ := json.Marshal(structuredResponseSchema())

	return &batch.RequestOptions{
		StructuredOutput: &batch.StructuredOutputConfig{
			Enabled:     true,
			Type:        batch.ResponseFormatTypeJSONSchema,
			Name:        "entity_relation_extraction",
			Description: "Structured entity and relationship extraction result",
			Strict:      true,
			Schema:      schema,
		},
	}
}

func structuredResponseSchema() map[string]interface{} {
	return map[string]interface{}{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"entities", "relations"},
		"properties": map[string]interface{}{
			"entities": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"label", "kind", "confidence"},
					"properties": map[string]interface{}{
						"label": map[string]interface{}{"type": "string"},
						"kind": map[string]interface{}{
							"type": "string",
							"enum": AllEntityKinds,
						},
						"confidence": map[string]interface{}{
							"type":    "number",
							"minimum": 0,
							"maximum": 1,
						},
						"aliases": map[string]interface{}{
							"type":  "array",
							"items": map[string]interface{}{"type": "string"},
						},
					},
				},
			},
			"relations": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type":                 "object",
					"additionalProperties": false,
					"required": []string{
						"subject",
						"object",
						"verb",
						"relationType",
						"confidence",
						"sourceSentence",
					},
					"properties": map[string]interface{}{
						"subject":        map[string]interface{}{"type": "string"},
						"subjectKind":    map[string]interface{}{"type": "string"},
						"object":         map[string]interface{}{"type": "string"},
						"objectKind":     map[string]interface{}{"type": "string"},
						"verb":           map[string]interface{}{"type": "string"},
						"relationType":   map[string]interface{}{"type": "string", "enum": AllRelationTypes},
						"manner":         map[string]interface{}{"type": "string"},
						"location":       map[string]interface{}{"type": "string"},
						"time":           map[string]interface{}{"type": "string"},
						"recipient":      map[string]interface{}{"type": "string"},
						"sourceSentence": map[string]interface{}{"type": "string"},
						"confidence": map[string]interface{}{
							"type":    "number",
							"minimum": 0,
							"maximum": 1,
						},
					},
				},
			},
		},
	}
}
