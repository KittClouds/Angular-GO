//go:build js && wasm
// +build js,wasm

package batch

import (
	"context"
	"encoding/json"
	"fmt"
	"syscall/js"
	"time"
)

// openRouterRequest represents the request body for OpenRouter API.
type openRouterRequest struct {
	Model       string                 `json:"model"`
	Messages    []openRouterMsg        `json:"messages"`
	Temperature float64                `json:"temperature"`
	MaxTokens   int                    `json:"max_tokens"`
	Stream      bool                   `json:"stream"`
	Reasoning   map[string]interface{} `json:"reasoning,omitempty"`
}

type openRouterMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// openRouterResponse represents the response from OpenRouter API.
type openRouterResponse struct {
	Choices []struct {
		Message struct {
			Content          string `json:"content"`
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// callOpenRouter makes a non-streaming request to OpenRouter API.
func (s *Service) callOpenRouter(_ context.Context, userPrompt, systemPrompt string) (string, error) {
	url := "https://openrouter.ai/api/v1/chat/completions"

	// Build messages
	messages := make([]openRouterMsg, 0, 2)
	if systemPrompt != "" {
		messages = append(messages, openRouterMsg{
			Role:    "system",
			Content: systemPrompt,
		})
	}
	messages = append(messages, openRouterMsg{
		Role:    "user",
		Content: userPrompt,
	})

	temperature := 0.3
	if s.config.Temperature != 0 {
		temperature = s.config.Temperature
	}
	maxTokens := 4096
	if s.config.MaxTokens != 0 {
		maxTokens = s.config.MaxTokens
	}

	// Build request body
	req := openRouterRequest{
		Model:       s.config.OpenRouterModel,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Stream:      false,
		Reasoning:   s.buildReasoningConfig(),
	}

	reqBody, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("batch: failed to marshal OpenRouter request: %w", err)
	}

	// Use browser fetch via syscall/js with auth headers
	response, err := s.jsFetchWithAuth(url, string(reqBody), s.config.OpenRouterAPIKey)
	if err != nil {
		return "", fmt.Errorf("batch: OpenRouter API request failed: %w", err)
	}

	// Parse response
	var resp openRouterResponse
	if err := json.Unmarshal([]byte(response), &resp); err != nil {
		return "", fmt.Errorf("batch: failed to parse OpenRouter response: %w", err)
	}

	// Check for API error
	if resp.Error != nil {
		return "", fmt.Errorf("batch: OpenRouter API error %d: %s", resp.Error.Code, resp.Error.Message)
	}

	// Extract text from response
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("batch: empty response from OpenRouter")
	}

	text := resp.Choices[0].Message.Content
	if text == "" {
		return "", fmt.Errorf("batch: empty content in OpenRouter response")
	}

	return text, nil
}

// jsFetchWithAuth performs a fetch request with Authorization header.
// OpenRouter requires Bearer token auth + extra headers.
func (s *Service) jsFetchWithAuth(url, body, apiKey string) (string, error) {
	// Get fetch function from global scope
	fetch := js.Global().Get("fetch")
	if fetch.IsUndefined() {
		return "", fmt.Errorf("batch: fetch not available")
	}

	// Get location.origin for HTTP-Referer header
	origin := js.Global().Get("location").Get("origin").String()

	// Create headers object
	headers := js.Global().Get("Object").New()
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	headers.Set("HTTP-Referer", origin)
	headers.Set("X-Title", "KittClouds")

	// Create options object
	options := js.Global().Get("Object").New()
	options.Set("method", "POST")
	options.Set("headers", headers)
	options.Set("body", body)

	// Call fetch
	promise := fetch.Invoke(url, options)

	// Wait for response using a channel
	responseCh := make(chan struct {
		val js.Value
		err error
	})

	fetchThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		result := args[0]
		go func() {
			responseCh <- struct {
				val js.Value
				err error
			}{result, nil}
		}()
		return nil
	})

	fetchCatch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		errMsg := args[0].Get("message").String()
		go func() {
			responseCh <- struct {
				val js.Value
				err error
			}{js.Undefined(), fmt.Errorf("fetch: %s", errMsg)}
		}()
		return nil
	})

	promise.Call("then", fetchThen).Call("catch", fetchCatch)

	fetchResult := <-responseCh
	go func() {
		// Wait long enough for the Promise resolution cycle to fully complete in JS land
		// before releasing the callbacks, avoiding "call to released function" errors.
		time.Sleep(50 * time.Millisecond)
		fetchThen.Release()
		fetchCatch.Release()
	}()

	if fetchResult.err != nil {
		return "", fetchResult.err
	}

	response := fetchResult.val

	// Read response text
	textPromise := response.Call("text")
	textCh := make(chan struct {
		text string
		err  error
	})

	textThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		text := args[0].String()
		go func() {
			textCh <- struct {
				text string
				err  error
			}{text, nil}
		}()
		return nil
	})

	textCatch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		errMsg := args[0].Get("message").String()
		go func() {
			textCh <- struct {
				text string
				err  error
			}{"", fmt.Errorf("text error: %s", errMsg)}
		}()
		return nil
	})

	textPromise.Call("then", textThen).Call("catch", textCatch)

	textResult := <-textCh
	go func() {
		// Wait long enough for the Promise resolution cycle to fully complete in JS land
		time.Sleep(50 * time.Millisecond)
		textThen.Release()
		textCatch.Release()
	}()

	if textResult.err != nil {
		return "", textResult.err
	}

	// Check for HTTP errors
	if !response.Get("ok").Bool() {
		status := response.Get("status").Int()
		return "", fmt.Errorf("HTTP %d: %s", status, textResult.text)
	}

	return textResult.text, nil
}
