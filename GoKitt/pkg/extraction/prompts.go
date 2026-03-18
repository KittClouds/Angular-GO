package extraction

import (
	"fmt"
	"strings"
)

// MaxTextLength is the maximum number of characters sent to the LLM.
// Matches the TypeScript relation extractor's 8000-char limit.
const MaxTextLength = 8000

// SystemPrompt keeps extraction behavior specific while leaving response
// enforcement to structured outputs when available.
const SystemPrompt = `You are an entity and relationship extraction assistant for narrative analysis.
Extract named entities AND relationships between them from the given text.
When a response schema is provided, follow it exactly.
Otherwise, return a JSON object with two arrays: "entities" and "relations".
No markdown or commentary.`

// BuildUserPrompt constructs the combined extraction prompt.
// knownEntities primes the LLM with entity labels already in the registry.
func BuildUserPrompt(text string, knownEntities []string) string {
	truncated := text
	if len(truncated) > MaxTextLength {
		truncated = truncated[:MaxTextLength]
	}

	var sb strings.Builder
	sb.WriteString("Extract named entities AND relationships from this text. ")
	sb.WriteString("If no response schema is supplied, respond as JSON with \"entities\" and \"relations\" arrays.\n\n")

	if len(knownEntities) > 0 {
		sb.WriteString("KNOWN ENTITIES (prioritize these):\n")
		sb.WriteString(strings.Join(knownEntities, ", "))
		sb.WriteString("\n\n")
	}

	sb.WriteString("=== ENTITIES ===\n")
	sb.WriteString("Each entity object:\n")
	sb.WriteString("- \"label\": Canonical name (string)\n")
	sb.WriteString(fmt.Sprintf("- \"kind\": One of: %s\n", strings.Join(AllEntityKinds, ", ")))
	sb.WriteString("- \"confidence\": 0.0-1.0 (number)\n")
	sb.WriteString("- \"aliases\": Optional array of alternative names (string[])\n\n")

	sb.WriteString("KIND GUIDE:\n")
	sb.WriteString("- CHARACTER: Main characters\n")
	sb.WriteString("- NPC: Side characters\n")
	sb.WriteString("- LOCATION: Places, buildings\n")
	sb.WriteString("- ITEM: Objects, artifacts\n")
	sb.WriteString("- FACTION: Organizations, groups\n")
	sb.WriteString("- EVENT: Historical events\n")
	sb.WriteString("- CONCEPT: Magic systems, lore\n\n")

	sb.WriteString("=== RELATIONS ===\n")
	sb.WriteString("Each relation object:\n")
	sb.WriteString("- \"subject\": Entity performing the action (string)\n")
	sb.WriteString("- \"object\": Entity receiving the action (string)\n")
	sb.WriteString("- \"verb\": The verb phrase from the text (string)\n")
	sb.WriteString(fmt.Sprintf("- \"relationType\": One of: %s\n", strings.Join(AllRelationTypes, ", ")))
	sb.WriteString("- \"manner\": Optional - how the action was performed (string)\n")
	sb.WriteString("- \"location\": Optional - where it happened (string)\n")
	sb.WriteString("- \"time\": Optional - when it happened (string)\n")
	sb.WriteString("- \"recipient\": Optional - for communication verbs, who was told (string)\n")
	sb.WriteString("- \"confidence\": 0.0-1.0 (number)\n")
	sb.WriteString("- \"sourceSentence\": The exact sentence this came from (string)\n\n")

	sb.WriteString("RULES:\n")
	sb.WriteString("1. Only proper nouns - skip generic terms\n")
	sb.WriteString("2. Deduplicate entities\n")
	sb.WriteString("3. One relationship per verb phrase\n")
	sb.WriteString("4. Include the exact source sentence for each relation\n")
	sb.WriteString("5. confidence >= 0.8 for explicit, 0.5-0.8 for implied\n\n")

	sb.WriteString("TEXT:\n")
	sb.WriteString(truncated)

	return sb.String()
}
