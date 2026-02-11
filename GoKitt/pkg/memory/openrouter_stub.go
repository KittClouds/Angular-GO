//go:build !js || !wasm

// Stub for non-WASM builds. Memory extraction requires browser fetch.
package memory

import "fmt"

// OpenRouterClient is a stub for non-WASM builds.
type OpenRouterClient struct {
	apiKey string
	model  string
}

// OpenRouterConfig holds configuration for the OpenRouter client.
type OpenRouterConfig struct {
	APIKey string
	Model  string
}

// NewOpenRouterClient creates a stub client (non-WASM).
func NewOpenRouterClient(config OpenRouterConfig) *OpenRouterClient {
	return &OpenRouterClient{apiKey: config.APIKey, model: config.Model}
}

// ExtractionResult represents the LLM's extracted memories.
type ExtractionResult struct {
	Memories []ExtractedMemory `json:"memories"`
}

// ExtractedMemory is a single memory extracted by the LLM.
type ExtractedMemory struct {
	Content    string  `json:"content"`
	MemoryType string  `json:"memory_type"`
	Confidence float64 `json:"confidence"`
}

// MessageInput represents a message for extraction.
type MessageInput struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ExtractMemories is a no-op stub for non-WASM builds.
func (c *OpenRouterClient) ExtractMemories(messages []MessageInput) (*ExtractionResult, error) {
	return nil, fmt.Errorf("memory extraction requires WASM environment")
}

// Complete is a no-op stub for non-WASM builds.
// Implements LLMClient interface for internal/memory package.
func (c *OpenRouterClient) Complete(userPrompt, systemPrompt string) (string, error) {
	return "", fmt.Errorf("LLM completion requires WASM environment")
}
