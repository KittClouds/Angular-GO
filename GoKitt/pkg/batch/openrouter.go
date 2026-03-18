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
func (s *Service) callOpenRouter(_ context.Context, userPrompt, systemPrompt string, requestOptions *RequestOptions) (string, error) {
	url := "https://openrouter.ai/api/v1/chat/completions"

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

	reqMap := map[string]interface{}{
		"model":       s.config.OpenRouterModel,
		"messages":    messages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
		"stream":      false,
	}
	if reasoning := s.buildReasoningConfig(); reasoning != nil {
		reqMap["reasoning"] = reasoning
	}
	optionPayload, err := buildOpenRouterOptionPayload(requestOptions, false)
	if err != nil {
		return "", err
	}
	for key, value := range optionPayload {
		reqMap[key] = value
	}

	reqBody, err := json.Marshal(reqMap)
	if err != nil {
		return "", fmt.Errorf("batch: failed to marshal OpenRouter request: %w", err)
	}

	response, err := s.jsFetchWithAuth(url, string(reqBody), s.config.OpenRouterAPIKey)
	if err != nil {
		return "", fmt.Errorf("batch: OpenRouter API request failed: %w", wrapStructuredOutputError(err, requestOptions))
	}

	var resp openRouterResponse
	if err := json.Unmarshal([]byte(response), &resp); err != nil {
		return "", fmt.Errorf("batch: failed to parse OpenRouter response: %w", err)
	}

	if resp.Error != nil {
		apiErr := fmt.Errorf("batch: OpenRouter API error %d: %s", resp.Error.Code, resp.Error.Message)
		return "", wrapStructuredOutputError(apiErr, requestOptions)
	}

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
	fetch := js.Global().Get("fetch")
	if fetch.IsUndefined() {
		return "", fmt.Errorf("batch: fetch not available")
	}

	origin := js.Global().Get("location").Get("origin").String()

	headers := js.Global().Get("Object").New()
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	headers.Set("HTTP-Referer", origin)
	headers.Set("X-Title", "KittClouds")

	options := js.Global().Get("Object").New()
	options.Set("method", "POST")
	options.Set("headers", headers)
	options.Set("body", body)

	promise := fetch.Invoke(url, options)

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
		time.Sleep(50 * time.Millisecond)
		fetchThen.Release()
		fetchCatch.Release()
	}()

	if fetchResult.err != nil {
		return "", fetchResult.err
	}

	response := fetchResult.val
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
		time.Sleep(50 * time.Millisecond)
		textThen.Release()
		textCatch.Release()
	}()

	if textResult.err != nil {
		return "", textResult.err
	}

	if !response.Get("ok").Bool() {
		status := response.Get("status").Int()
		return "", fmt.Errorf("HTTP %d: %s", status, textResult.text)
	}

	return textResult.text, nil
}
