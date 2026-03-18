package batch

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	ResponseFormatTypeJSONObject = "json_object"
	ResponseFormatTypeJSONSchema = "json_schema"

	OpenRouterPluginResponseHealing = "response-healing"

	defaultStructuredOutputName = "structured_output"
)

// StructuredOutputConfig configures OpenRouter response_format handling.
type StructuredOutputConfig struct {
	Enabled     bool            `json:"enabled,omitempty"`
	Type        string          `json:"type,omitempty"`
	Schema      json.RawMessage `json:"schema,omitempty"`
	Strict      bool            `json:"strict,omitempty"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
}

// OpenRouterPlugin enables an OpenRouter plugin by id.
type OpenRouterPlugin struct {
	ID string `json:"id"`
}

// RequestOptions configures request-level OpenRouter features.
type RequestOptions struct {
	StructuredOutput *StructuredOutputConfig `json:"structuredOutput,omitempty"`
	Plugins          []OpenRouterPlugin      `json:"plugins,omitempty"`
}

func (s *Service) defaultRequestOptions() *RequestOptions {
	if s == nil {
		return nil
	}

	return cloneRequestOptions(&RequestOptions{
		StructuredOutput: s.config.StructuredOutput,
		Plugins:          s.config.Plugins,
	})
}

func mergeRequestOptions(base, override *RequestOptions) *RequestOptions {
	if base == nil && override == nil {
		return nil
	}

	merged := cloneRequestOptions(base)
	if merged == nil {
		merged = &RequestOptions{}
	}

	if override == nil {
		return mergedOrNil(merged)
	}

	if override.StructuredOutput != nil {
		merged.StructuredOutput = cloneStructuredOutputConfig(override.StructuredOutput)
	}
	if override.Plugins != nil {
		merged.Plugins = clonePlugins(override.Plugins)
	}

	return mergedOrNil(merged)
}

func cloneRequestOptions(opts *RequestOptions) *RequestOptions {
	if opts == nil {
		return nil
	}

	return &RequestOptions{
		StructuredOutput: cloneStructuredOutputConfig(opts.StructuredOutput),
		Plugins:          clonePlugins(opts.Plugins),
	}
}

func cloneStructuredOutputConfig(cfg *StructuredOutputConfig) *StructuredOutputConfig {
	if cfg == nil {
		return nil
	}

	cloned := *cfg
	if cfg.Schema != nil {
		cloned.Schema = append(json.RawMessage(nil), cfg.Schema...)
	}
	return &cloned
}

func clonePlugins(plugins []OpenRouterPlugin) []OpenRouterPlugin {
	if plugins == nil {
		return nil
	}

	cloned := make([]OpenRouterPlugin, len(plugins))
	copy(cloned, plugins)
	return cloned
}

func mergedOrNil(opts *RequestOptions) *RequestOptions {
	if opts == nil {
		return nil
	}
	if opts.StructuredOutput == nil && len(opts.Plugins) == 0 {
		return nil
	}
	return opts
}

func hasOpenRouterOptions(opts *RequestOptions) bool {
	if opts == nil {
		return false
	}
	return opts.StructuredOutput != nil || len(opts.Plugins) > 0
}

func buildOpenRouterOptionPayload(opts *RequestOptions, streaming bool) (map[string]interface{}, error) {
	if opts == nil {
		return nil, nil
	}

	payload := map[string]interface{}{}

	if opts.StructuredOutput != nil {
		responseFormat, err := buildResponseFormatPayload(opts.StructuredOutput)
		if err != nil {
			return nil, err
		}
		if responseFormat != nil {
			payload["response_format"] = responseFormat
		}
	}

	if len(opts.Plugins) > 0 {
		plugins, err := buildPluginPayload(opts.Plugins, streaming)
		if err != nil {
			return nil, err
		}
		payload["plugins"] = plugins
	}

	if len(payload) == 0 {
		return nil, nil
	}

	return payload, nil
}

func buildResponseFormatPayload(cfg *StructuredOutputConfig) (map[string]interface{}, error) {
	normalized, err := normalizeStructuredOutputConfig(cfg)
	if err != nil {
		return nil, err
	}
	if normalized == nil {
		return nil, nil
	}

	switch normalized.Type {
	case ResponseFormatTypeJSONObject:
		return map[string]interface{}{
			"type": ResponseFormatTypeJSONObject,
		}, nil
	case ResponseFormatTypeJSONSchema:
		schemaPayload, err := parseJSONSchema(normalized.Schema)
		if err != nil {
			return nil, err
		}

		jsonSchema := map[string]interface{}{
			"name":   normalized.Name,
			"schema": schemaPayload,
		}
		if normalized.Strict {
			jsonSchema["strict"] = true
		}
		if strings.TrimSpace(normalized.Description) != "" {
			jsonSchema["description"] = normalized.Description
		}

		return map[string]interface{}{
			"type":        ResponseFormatTypeJSONSchema,
			"json_schema": jsonSchema,
		}, nil
	default:
		return nil, fmt.Errorf("batch: unsupported structured output type %q", normalized.Type)
	}
}

func normalizeStructuredOutputConfig(cfg *StructuredOutputConfig) (*StructuredOutputConfig, error) {
	if cfg == nil || !cfg.Enabled {
		return nil, nil
	}

	normalized := cloneStructuredOutputConfig(cfg)
	normalized.Type = strings.TrimSpace(normalized.Type)
	if normalized.Type == "" {
		normalized.Type = ResponseFormatTypeJSONSchema
	}

	switch normalized.Type {
	case ResponseFormatTypeJSONObject:
		normalized.Schema = nil
	case ResponseFormatTypeJSONSchema:
		if len(normalized.Schema) == 0 {
			return nil, fmt.Errorf("batch: structured output type %q requires a JSON schema", ResponseFormatTypeJSONSchema)
		}
		normalized.Name = strings.TrimSpace(normalized.Name)
		if normalized.Name == "" {
			normalized.Name = defaultStructuredOutputName
		}
	default:
		return nil, fmt.Errorf("batch: unsupported structured output type %q", normalized.Type)
	}

	return normalized, nil
}

func parseJSONSchema(raw json.RawMessage) (interface{}, error) {
	var schema interface{}
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, fmt.Errorf("batch: invalid structured output schema: %w", err)
	}

	if _, ok := schema.(map[string]interface{}); !ok {
		return nil, fmt.Errorf("batch: structured output schema must be a JSON object")
	}

	return schema, nil
}

func buildPluginPayload(plugins []OpenRouterPlugin, streaming bool) ([]map[string]string, error) {
	payload := make([]map[string]string, 0, len(plugins))

	for _, plugin := range plugins {
		id := strings.TrimSpace(plugin.ID)
		if id == "" {
			return nil, fmt.Errorf("batch: plugin id cannot be empty")
		}
		if streaming && id == OpenRouterPluginResponseHealing {
			return nil, fmt.Errorf("batch: plugin %q is only supported for non-streaming requests", id)
		}

		payload = append(payload, map[string]string{"id": id})
	}

	return payload, nil
}

func wrapStructuredOutputError(err error, opts *RequestOptions) error {
	if err == nil || !hasOpenRouterOptions(opts) {
		return err
	}

	if opts != nil && opts.StructuredOutput != nil && opts.StructuredOutput.Enabled {
		return fmt.Errorf("%w; structured output was enabled, so verify the selected model supports response_format", err)
	}

	if len(opts.Plugins) > 0 {
		return fmt.Errorf("%w; OpenRouter plugins were enabled for this request", err)
	}

	return err
}
