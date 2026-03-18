package extraction

import "testing"

func TestStructuredRequestOptions_UsesStrictJSONSchema(t *testing.T) {
	opts := StructuredRequestOptions()
	if opts == nil || opts.StructuredOutput == nil {
		t.Fatal("expected structured output options")
	}
	if !opts.StructuredOutput.Enabled {
		t.Fatal("expected structured output to be enabled")
	}
	if !opts.StructuredOutput.Strict {
		t.Fatal("expected strict schema mode")
	}
	if opts.StructuredOutput.Type != "json_schema" {
		t.Fatalf("expected json_schema type, got %q", opts.StructuredOutput.Type)
	}
	if len(opts.StructuredOutput.Schema) == 0 {
		t.Fatal("expected schema payload")
	}
}

func TestStructuredResponseSchema_RequiresEntitiesAndRelations(t *testing.T) {
	schema := structuredResponseSchema()
	required, ok := schema["required"].([]string)
	if !ok {
		t.Fatalf("expected required fields slice, got %#v", schema["required"])
	}
	if len(required) != 2 || required[0] != "entities" || required[1] != "relations" {
		t.Fatalf("unexpected required fields: %#v", required)
	}
}
