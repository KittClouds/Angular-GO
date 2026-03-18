// Package batch provides non-streaming LLM completion services.
// Used for entity extraction, relation extraction, and other batch operations.
//
// Supports two providers:
//   - Google GenAI (generativelanguage.googleapis.com)
//   - OpenRouter (openrouter.ai)
//
// All HTTP calls use syscall/js to leverage the browser's fetch API,
// avoiding CORS issues in WASM environment.
package batch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Provider type for LLM providers.
type Provider string

const (
	ProviderGoogle     Provider = "google"
	ProviderOpenRouter Provider = "openrouter"
)

// Config holds batch LLM settings passed from TypeScript.
type Config struct {
	Provider           Provider                `json:"provider"`
	GoogleAPIKey       string                  `json:"googleApiKey"`
	GoogleModel        string                  `json:"googleModel"`
	OpenRouterAPIKey   string                  `json:"openRouterApiKey"`
	OpenRouterModel    string                  `json:"openRouterModel"`
	Temperature        float64                 `json:"temperature"`
	MaxTokens          int                     `json:"maxTokens"`
	ReasoningEnabled   bool                    `json:"reasoningEnabled"`
	ReasoningEffort    string                  `json:"reasoningEffort"`
	ReasoningMaxTokens int                     `json:"reasoningMaxTokens"`
	IncludeReasoning   bool                    `json:"includeReasoning"`
	StructuredOutput   *StructuredOutputConfig `json:"structuredOutput,omitempty"`
	Plugins            []OpenRouterPlugin      `json:"plugins,omitempty"`
}

// Service handles non-streaming LLM completions.
type Service struct {
	config Config
}

// NewService creates a batch service with config from TypeScript.
func NewService(config Config) *Service {
	return &Service{config: config}
}

// UpdateConfig updates the service configuration.
func (s *Service) UpdateConfig(config Config) {
	s.config = config
}

// GetConfig returns the current configuration.
func (s *Service) GetConfig() Config {
	return s.config
}

// IsConfigured checks if the current provider has valid credentials.
func (s *Service) IsConfigured() bool {
	switch s.config.Provider {
	case ProviderGoogle:
		return s.config.GoogleAPIKey != ""
	case ProviderOpenRouter:
		return s.config.OpenRouterAPIKey != ""
	default:
		return false
	}
}

// SupportsStructuredOutput reports whether the current provider supports
// response_format and OpenRouter plugins in this service.
func (s *Service) SupportsStructuredOutput() bool {
	return s.config.Provider == ProviderOpenRouter
}

// GetCurrentModel returns the model for the current provider.
func (s *Service) GetCurrentModel() string {
	switch s.config.Provider {
	case ProviderGoogle:
		return s.config.GoogleModel
	case ProviderOpenRouter:
		return s.config.OpenRouterModel
	default:
		return ""
	}
}

// Complete makes a non-streaming LLM completion request.
// Returns the full response text.
func (s *Service) Complete(ctx context.Context, userPrompt, systemPrompt string) (string, error) {
	return s.CompleteWithOptions(ctx, userPrompt, systemPrompt, nil)
}

// CompleteWithOptions makes a non-streaming LLM completion request with
// optional OpenRouter-specific request controls.
func (s *Service) CompleteWithOptions(ctx context.Context, userPrompt, systemPrompt string, requestOptions *RequestOptions) (string, error) {
	if !s.IsConfigured() {
		return "", errors.New("batch: provider not configured")
	}

	mergedOptions := mergeRequestOptions(s.defaultRequestOptions(), requestOptions)

	switch s.config.Provider {
	case ProviderGoogle:
		if hasOpenRouterOptions(mergedOptions) {
			return "", errors.New("batch: structured outputs are only supported via OpenRouter")
		}
		return s.callGoogle(ctx, userPrompt, systemPrompt)
	case ProviderOpenRouter:
		return s.callOpenRouter(ctx, userPrompt, systemPrompt, mergedOptions)
	default:
		return "", errors.New("batch: unknown provider")
	}
}

// CompleteWithTools makes a non-streaming LLM request with tool schemas.
// Accepts any messages/tools structure and returns the raw JSON response
// for the caller to parse (preserves tool_calls in response).
//
// Only OpenRouter is supported for tool calling.
func (s *Service) CompleteWithTools(ctx context.Context, messages interface{}, tools interface{}) (string, error) {
	if !s.IsConfigured() {
		return "", errors.New("batch: provider not configured")
	}

	if s.config.Provider != ProviderOpenRouter {
		return "", errors.New("batch: tool calling only supported via OpenRouter")
	}

	_ = ctx

	temperature := 0.7
	if s.config.Temperature != 0 {
		temperature = s.config.Temperature
	}
	maxTokens := 2048
	if s.config.MaxTokens != 0 {
		maxTokens = s.config.MaxTokens
	}

	// Build full request body
	reqMap := map[string]interface{}{
		"model":       s.config.OpenRouterModel,
		"messages":    messages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
		"stream":      false,
	}
	if tools != nil {
		reqMap["tools"] = tools
	}

	reqBody, err := json.Marshal(reqMap)
	if err != nil {
		return "", fmt.Errorf("batch: failed to marshal tool request: %w", err)
	}

	// Use the same jsFetchWithAuth that callOpenRouter uses
	raw, err := s.jsFetchWithAuth(
		"https://openrouter.ai/api/v1/chat/completions",
		string(reqBody),
		s.config.OpenRouterAPIKey,
	)
	if err != nil {
		return "", fmt.Errorf("batch: OpenRouter tool API request failed: %w", err)
	}

	return raw, nil
}
