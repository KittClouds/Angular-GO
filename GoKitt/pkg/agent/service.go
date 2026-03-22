// Package agent provides non-streaming LLM completions with tool-calling support.
// Used by the agentic chat loop for function-calling interactions.
//
// This is the Go-side "backend LLM logic" that replaces the chatWithTools
// method from openrouter.service.ts. The tool schemas, tool executor, and
// editor bridge remain in TypeScript since they touch the DOM.
package agent

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/kittclouds/gokitt/pkg/batch"
)

// Message represents a chat message in the OpenRouter/Google format.
type Message struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"` // Pointer to allow null
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// ToolCall represents a function call from the LLM.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

// FunctionCall is the function name + arguments in a tool call.
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolDefinition is the OpenRouter-compatible tool schema.
type ToolDefinition struct {
	Type     string             `json:"type"`
	Function ToolFunctionSchema `json:"function"`
}

// ToolFunctionSchema describes a tool function.
type ToolFunctionSchema struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// CompletionResult is the return from a tool-calling LLM request.
type CompletionResult struct {
	Content   *string    `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// Service wraps batch.Service to provide tool-calling completions.
type Service struct {
	batch *batch.Service
}

// NewService creates an agent service.
func NewService(b *batch.Service) *Service {
	return &Service{batch: b}
}

// Chat performs a plain non-tool LLM completion.
func (s *Service) Chat(ctx context.Context, userPrompt, systemPrompt string) (*CompletionResult, error) {
	if s.batch == nil {
		return nil, fmt.Errorf("agent: batch service not initialized")
	}

	content, err := s.batch.Complete(ctx, userPrompt, systemPrompt)
	if err != nil {
		return nil, fmt.Errorf("agent: LLM call failed: %w", err)
	}

	return &CompletionResult{Content: &content}, nil
}

// ChatWithTools performs a non-streaming LLM call that may return tool_calls.
// This replaces openrouter.service.ts chatWithTools().
//
// The actual HTTP call goes through batch.Service which uses syscall/js fetch.
func (s *Service) ChatWithTools(
	ctx context.Context,
	messages []Message,
	tools []ToolDefinition,
	systemPrompt string,
) (*CompletionResult, error) {
	if s.batch == nil {
		return nil, fmt.Errorf("agent: batch service not initialized")
	}
	if !s.batch.IsConfigured() {
		return nil, fmt.Errorf("agent: LLM provider not configured")
	}

	// Build full message list with system prompt
	fullMessages := make([]Message, 0, len(messages)+1)
	if systemPrompt != "" {
		content := systemPrompt
		fullMessages = append(fullMessages, Message{
			Role:    "system",
			Content: &content,
		})
	}
	fullMessages = append(fullMessages, messages...)

	// Use batch service's CompleteWithTools for full request control
	raw, err := s.batch.CompleteWithTools(ctx, fullMessages, tools)
	if err != nil {
		return nil, fmt.Errorf("agent: LLM call failed: %w", err)
	}

	// Parse the OpenRouter/Google response
	return parseCompletionResponse(raw)
}

// parseCompletionResponse extracts content and tool_calls from raw API response.
func parseCompletionResponse(raw string) (*CompletionResult, error) {
	var response struct {
		Choices []struct {
			Message struct {
				Content   *string    `json:"content"`
				ToolCalls []ToolCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return nil, fmt.Errorf("agent: failed to parse response: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("agent: no response from model")
	}

	choice := response.Choices[0].Message
	return &CompletionResult{
		Content:   choice.Content,
		ToolCalls: choice.ToolCalls,
	}, nil
}
