package batch

import "testing"

func TestNormalizeStructuredOutputConfig_DefaultsToJSONSchema(t *testing.T) {
	cfg, err := normalizeStructuredOutputConfig(&StructuredOutputConfig{
		Enabled: true,
		Schema:  []byte(`{"type":"object"}`),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("expected config")
	}
	if cfg.Type != ResponseFormatTypeJSONSchema {
		t.Fatalf("expected %q, got %q", ResponseFormatTypeJSONSchema, cfg.Type)
	}
	if cfg.Name != defaultStructuredOutputName {
		t.Fatalf("expected default name %q, got %q", defaultStructuredOutputName, cfg.Name)
	}
}

func TestBuildResponseFormatPayload_JSONSchema(t *testing.T) {
	payload, err := buildResponseFormatPayload(&StructuredOutputConfig{
		Enabled: true,
		Type:    ResponseFormatTypeJSONSchema,
		Name:    "demo_schema",
		Strict:  true,
		Schema:  []byte(`{"type":"object","properties":{"ok":{"type":"boolean"}}}`),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if payload["type"] != ResponseFormatTypeJSONSchema {
		t.Fatalf("expected response format type %q, got %#v", ResponseFormatTypeJSONSchema, payload["type"])
	}
	jsonSchema, ok := payload["json_schema"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected json_schema payload, got %#v", payload["json_schema"])
	}
	if jsonSchema["name"] != "demo_schema" {
		t.Fatalf("expected schema name, got %#v", jsonSchema["name"])
	}
}

func TestBuildPluginPayload_RejectsResponseHealingForStreaming(t *testing.T) {
	_, err := buildPluginPayload([]OpenRouterPlugin{{ID: OpenRouterPluginResponseHealing}}, true)
	if err == nil {
		t.Fatal("expected error for response-healing plugin on streaming requests")
	}
}

func TestMergeRequestOptions_OverrideStructuredPreserveBasePlugins(t *testing.T) {
	merged := mergeRequestOptions(
		&RequestOptions{Plugins: []OpenRouterPlugin{{ID: OpenRouterPluginResponseHealing}}},
		&RequestOptions{StructuredOutput: &StructuredOutputConfig{Enabled: true, Type: ResponseFormatTypeJSONObject}},
	)
	if merged == nil {
		t.Fatal("expected merged options")
	}
	if merged.StructuredOutput == nil || merged.StructuredOutput.Type != ResponseFormatTypeJSONObject {
		t.Fatalf("expected overridden structured output, got %#v", merged.StructuredOutput)
	}
	if len(merged.Plugins) != 1 || merged.Plugins[0].ID != OpenRouterPluginResponseHealing {
		t.Fatalf("expected base plugins to be preserved, got %#v", merged.Plugins)
	}
}
