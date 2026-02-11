// Package memory provides the Observational Memory pipeline for GoKitt.
// Implements the three-agent architecture: Observer → Reflector → Actor.
package memory

import (
	"encoding/json"
	"fmt"
)

// ObserverResult represents the output of the Observer agent.
type ObserverResult struct {
	Observations string `json:"observations"` // New observations to merge (prose format)
	CurrentTask  string `json:"currentTask"`  // What the user is currently working on
}

// Observer extracts observations from conversation messages using LLM.
type Observer struct {
	llm LLMClient
}

// NewObserver creates a new Observer with the given LLM client.
func NewObserver(llm LLMClient) *Observer {
	return &Observer{llm: llm}
}

// Observe extracts observations from unobserved messages.
// existingObs is the current accumulated observations (may be empty).
func (o *Observer) Observe(messages []MessageContent, existingObs string) (*ObserverResult, error) {
	if len(messages) == 0 {
		return &ObserverResult{Observations: existingObs, CurrentTask: ""}, nil
	}

	prompt := buildObservePrompt(messages, existingObs)

	response, err := o.llm.Complete(prompt, observerSystemPrompt)
	if err != nil {
		return nil, fmt.Errorf("observer: LLM call failed: %w", err)
	}

	var result ObserverResult
	if err := json.Unmarshal([]byte(response), &result); err != nil {
		return nil, fmt.Errorf("observer: failed to parse result: %w", err)
	}

	return &result, nil
}

// observerSystemPrompt instructs the LLM how to extract observations.
const observerSystemPrompt = `You are an observational memory system. Your task is to extract and maintain observations from conversations.

You must return a JSON object with this exact structure:
{
  "observations": "A prose summary of all observations, including both existing and new. Write as natural paragraphs, not bullet points.",
  "currentTask": "A brief description of what the user is currently working on or trying to accomplish"
}

Observation Guidelines:
1. Merge new observations with existing ones coherently
2. Remove redundant or outdated information
3. Track the user's current task/goal
4. Preserve important details: names, dates, preferences, decisions
5. Ignore greetings, pleasantries, and meta-conversation
6. Be concise but comprehensive
7. Write observations as flowing prose, not bullet lists

If there are no meaningful observations, return:
{
  "observations": "",
  "currentTask": ""
}`

// buildObservePrompt creates the user prompt for observation.
func buildObservePrompt(messages []MessageContent, existingObs string) string {
	prompt := ""

	if existingObs != "" {
		prompt += fmt.Sprintf("Existing observations:\n%s\n\n", existingObs)
	}

	prompt += "New messages to observe:\n\n"
	for _, msg := range messages {
		prompt += fmt.Sprintf("[%s]: %s\n", msg.Role, msg.Content)
	}

	return prompt
}
