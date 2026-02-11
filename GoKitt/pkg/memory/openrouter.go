//go:build js && wasm

// Package memory provides observational memory extraction and management.
// Uses browser fetch API (via syscall/js) for LLM-based memory extraction.
package memory

import (
	"encoding/json"
	"fmt"
	"syscall/js"
)

// OpenRouterClient wraps browser-native fetch for memory extraction.
type OpenRouterClient struct {
	apiKey string
	model  string
}

// OpenRouterConfig holds configuration for the OpenRouter client.
type OpenRouterConfig struct {
	APIKey string
	Model  string // e.g., "nvidia/nemotron-3-nano-30b-a3b:free"
}

// NewOpenRouterClient creates a new OpenRouter client for memory extraction.
func NewOpenRouterClient(config OpenRouterConfig) *OpenRouterClient {
	return &OpenRouterClient{
		apiKey: config.APIKey,
		model:  config.Model,
	}
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

// openRouterRequest represents the request body for OpenRouter API.
type openRouterRequest struct {
	Model          string          `json:"model"`
	Messages       []openRouterMsg `json:"messages"`
	Temperature    float64         `json:"temperature"`
	MaxTokens      int             `json:"max_tokens"`
	Stream         bool            `json:"stream"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
}

type openRouterMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responseFormat struct {
	Type string `json:"type"`
}

// openRouterResponse represents the response from OpenRouter API.
type openRouterResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// ExtractMemories uses the LLM to extract factual observations from conversation messages.
// Uses browser fetch API via syscall/js — no Go net/http (which has no transport in WASM).
func (c *OpenRouterClient) ExtractMemories(messages []MessageInput) (*ExtractionResult, error) {
	prompt := buildExtractionPrompt(messages)

	// Build request body
	req := openRouterRequest{
		Model: c.model,
		Messages: []openRouterMsg{
			{Role: "system", Content: extractionSystemPrompt},
			{Role: "user", Content: prompt},
		},
		Temperature:    0.3, // Lower temperature for consistent extraction
		MaxTokens:      4096,
		Stream:         false,
		ResponseFormat: &responseFormat{Type: "json_object"},
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("memory: failed to marshal request: %w", err)
	}

	// Use browser fetch via syscall/js
	raw, err := c.jsFetchWithAuth(
		"https://openrouter.ai/api/v1/chat/completions",
		string(reqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("memory: OpenRouter API request failed: %w", err)
	}

	// Parse response
	var resp openRouterResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return nil, fmt.Errorf("memory: failed to parse response: %w", err)
	}

	if resp.Error != nil {
		return nil, fmt.Errorf("memory: OpenRouter API error %d: %s", resp.Error.Code, resp.Error.Message)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("memory: empty response from OpenRouter")
	}

	content := resp.Choices[0].Message.Content
	if content == "" {
		return nil, fmt.Errorf("memory: empty content in response")
	}

	// Parse the JSON extraction result
	var result ExtractionResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("memory: failed to parse extraction result: %w", err)
	}

	// Validate and normalize memory types
	for i := range result.Memories {
		if !isValidMemoryType(result.Memories[i].MemoryType) {
			result.Memories[i].MemoryType = "fact" // Default to fact
		}
		if result.Memories[i].Confidence < 0 || result.Memories[i].Confidence > 1 {
			result.Memories[i].Confidence = 0.5
		}
	}

	return &result, nil
}

// jsFetchWithAuth performs a fetch request with OpenRouter auth headers.
// Mirrors the pattern in pkg/batch/openrouter.go.
func (c *OpenRouterClient) jsFetchWithAuth(url, body string) (string, error) {
	fetch := js.Global().Get("fetch")
	if fetch.IsUndefined() {
		return "", fmt.Errorf("memory: fetch not available")
	}

	origin := js.Global().Get("window").Get("location").Get("origin").String()

	// Create headers
	headers := js.Global().Get("Object").New()
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", fmt.Sprintf("Bearer %s", c.apiKey))
	headers.Set("HTTP-Referer", origin)
	headers.Set("X-Title", "KittClouds")

	// Create options
	options := js.Global().Get("Object").New()
	options.Set("method", "POST")
	options.Set("headers", headers)
	options.Set("body", body)

	// Call fetch
	promise := fetch.Invoke(url, options)

	// Wait for response using a channel
	resultCh := make(chan struct {
		response string
		err      error
	})

	then := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		response := args[0]

		status := response.Get("status").Int()
		if !response.Get("ok").Bool() {
			textPromise := response.Call("text")
			textThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
				errText := args[0].String()
				resultCh <- struct {
					response string
					err      error
				}{response: "", err: fmt.Errorf("HTTP %d: %s", status, errText)}
				return nil
			})
			defer textThen.Release()
			textPromise.Call("then", textThen)
			return nil
		}

		textPromise := response.Call("text")
		textThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
			text := args[0].String()
			resultCh <- struct {
				response string
				err      error
			}{response: text, err: nil}
			return nil
		})
		defer textThen.Release()
		textPromise.Call("then", textThen)
		return nil
	})
	defer then.Release()

	catch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		errMsg := args[0].Get("message").String()
		resultCh <- struct {
			response string
			err      error
		}{response: "", err: fmt.Errorf("%s", errMsg)}
		return nil
	})
	defer catch.Release()

	promise.Call("then", then).Call("catch", catch)

	result := <-resultCh
	return result.response, result.err
}

// extractionSystemPrompt is the system prompt for memory extraction.
const extractionSystemPrompt = `You are a memory extraction system. Your task is to extract factual observations from conversations.

You must return a JSON object with this exact structure:
{
  "memories": [
    {
      "content": "The extracted fact as a clear, self-contained statement",
      "memory_type": "fact|preference|entity_mention|relation",
      "confidence": 0.0-1.0
    }
  ]
}

Memory Type Guidelines:
- "fact": Objective statements about the world, events, or circumstances
- "preference": User preferences, likes, dislikes, or opinions
- "entity_mention": References to specific people, places, things, or concepts
- "relation": Relationships between entities (e.g., "X works at Y")

Extraction Rules:
1. Extract only EXPLICIT information, not assumptions or implications
2. Each memory should be atomic and self-contained
3. Prefer specific over vague statements
4. Ignore greetings, pleasantries, and meta-conversation
5. Combine related information into single memories when appropriate
6. Assign high confidence (0.8-1.0) only for explicit, unambiguous statements
7. Assign medium confidence (0.5-0.7) for implied or contextual information
8. Assign low confidence (0.0-0.4) for uncertain or ambiguous extractions

If no meaningful memories can be extracted, return: {"memories": []}`

// buildExtractionPrompt creates the user prompt from conversation messages.
func buildExtractionPrompt(messages []MessageInput) string {
	prompt := "Extract memories from the following conversation:\n\n"
	for _, msg := range messages {
		prompt += fmt.Sprintf("[%s]: %s\n", msg.Role, msg.Content)
	}
	return prompt
}

// isValidMemoryType checks if a memory type is valid.
func isValidMemoryType(mt string) bool {
	switch mt {
	case "fact", "preference", "entity_mention", "relation":
		return true
	default:
		return false
	}
}

// Complete sends a prompt to the LLM and returns the response.
// Implements LLMClient interface for internal/memory package.
func (c *OpenRouterClient) Complete(userPrompt, systemPrompt string) (string, error) {
	req := openRouterRequest{
		Model: c.model,
		Messages: []openRouterMsg{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature:    0.3,
		MaxTokens:      4096,
		Stream:         false,
		ResponseFormat: &responseFormat{Type: "json_object"},
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("memory: failed to marshal request: %w", err)
	}

	raw, err := c.jsFetchWithAuth(
		"https://openrouter.ai/api/v1/chat/completions",
		string(reqBody),
	)
	if err != nil {
		return "", fmt.Errorf("memory: OpenRouter API request failed: %w", err)
	}

	var resp openRouterResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		return "", fmt.Errorf("memory: failed to parse response: %w", err)
	}

	if resp.Error != nil {
		return "", fmt.Errorf("memory: OpenRouter API error %d: %s", resp.Error.Code, resp.Error.Message)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("memory: empty response from OpenRouter")
	}

	return resp.Choices[0].Message.Content, nil
}
