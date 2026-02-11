// Package memory provides the Observational Memory pipeline for GoKitt.
// Implements the three-agent architecture: Observer → Reflector → Actor.
package memory

import (
	"encoding/json"
	"fmt"
)

// ReflectorResult represents the output of the Reflector agent.
type ReflectorResult struct {
	Condensed  string `json:"condensed"`  // Compressed observations
	TokenCount int    `json:"tokenCount"` // Estimated token count of condensed output
}

// Reflector compresses observations when they exceed the threshold.
type Reflector struct {
	llm        LLMClient
	maxRetries int
}

// NewReflector creates a new Reflector with the given LLM client.
func NewReflector(llm LLMClient, maxRetries int) *Reflector {
	if maxRetries <= 0 {
		maxRetries = 2
	}
	return &Reflector{llm: llm, maxRetries: maxRetries}
}

// Reflect compresses observations that exceed the target token count.
// Retries if output still exceeds target.
func (r *Reflector) Reflect(observations string, targetTokens int) (*ReflectorResult, error) {
	if observations == "" {
		return &ReflectorResult{Condensed: "", TokenCount: 0}, nil
	}

	currentObs := observations
	var result ReflectorResult

	for attempt := 0; attempt <= r.maxRetries; attempt++ {
		prompt := buildReflectPrompt(currentObs, targetTokens, attempt)

		response, err := r.llm.Complete(prompt, reflectorSystemPrompt)
		if err != nil {
			return nil, fmt.Errorf("reflector: LLM call failed: %w", err)
		}

		var parsed struct {
			Condensed string `json:"condensed"`
		}
		if err := json.Unmarshal([]byte(response), &parsed); err != nil {
			return nil, fmt.Errorf("reflector: failed to parse result: %w", err)
		}

		tokenCount := EstimateTokens(parsed.Condensed)

		// Success if under target
		if tokenCount <= targetTokens {
			result.Condensed = parsed.Condensed
			result.TokenCount = tokenCount
			return &result, nil
		}

		// Try again with more aggressive compression
		currentObs = parsed.Condensed
	}

	// Return best effort after retries
	result.Condensed = currentObs
	result.TokenCount = EstimateTokens(currentObs)
	return &result, nil
}

// reflectorSystemPrompt instructs the LLM how to compress observations.
const reflectorSystemPrompt = `You are an observation compression system. Your task is to condense observations while preserving essential information.

You must return a JSON object with this exact structure:
{
  "condensed": "The compressed observations as concise prose"
}

Compression Guidelines:
1. Remove redundant information
2. Combine related observations
3. Keep specific details: names, dates, decisions
4. Remove outdated or superseded information
5. Maintain chronological order where relevant
6. Be concise but comprehensive
7. Write as prose, not bullet points

Target: Compress to approximately the requested token count while preserving all essential information.`

// buildReflectPrompt creates the user prompt for reflection.
func buildReflectPrompt(observations string, targetTokens int, attempt int) string {
	prompt := fmt.Sprintf("Current observations (%d tokens):\n%s\n\n", EstimateTokens(observations), observations)

	if attempt == 0 {
		prompt += fmt.Sprintf("Compress these observations to approximately %d tokens while preserving essential information.", targetTokens)
	} else {
		prompt += fmt.Sprintf("The previous compression was still too long. Compress more aggressively to approximately %d tokens. Remove less essential details.", targetTokens)
	}

	return prompt
}
