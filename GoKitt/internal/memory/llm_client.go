// Package memory provides the Observational Memory pipeline for GoKitt.
// Implements the three-agent architecture: Observer → Reflector → Actor.
package memory

// LLMClient is the interface for LLM completion calls.
// Implemented by OpenRouterClient in pkg/memory.
type LLMClient interface {
	// Complete sends a prompt to the LLM and returns the response.
	// systemPrompt is the system instruction, userPrompt is the user message.
	Complete(userPrompt, systemPrompt string) (string, error)
}
