//go:build js && wasm
// +build js,wasm

package batch

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
	"time"
)

// StreamChatMessage represents a message in the streaming chat request.
type StreamChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChat performs a streaming OpenRouter API call.
// It calls onChunk for answer deltas and onReasoning for reasoning deltas.
func (s *Service) StreamChat(
	messagesJSON string,
	systemPrompt string,
	requestOptionsJSON string,
	onChunk func(chunk string),
	onReasoning func(chunk string),
) (string, error) {
	if !s.IsConfigured() {
		return "", fmt.Errorf("batch: provider not configured")
	}
	if s.config.Provider != ProviderOpenRouter {
		return "", fmt.Errorf("batch: streaming chat only supported via OpenRouter")
	}

	var messages []StreamChatMessage
	if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
		return "", fmt.Errorf("batch: invalid messages JSON: %w", err)
	}

	var requestOptions *RequestOptions
	if strings.TrimSpace(requestOptionsJSON) != "" {
		if err := json.Unmarshal([]byte(requestOptionsJSON), &requestOptions); err != nil {
			return "", fmt.Errorf("batch: invalid request options JSON: %w", err)
		}
	}
	requestOptions = mergeRequestOptions(s.defaultRequestOptions(), requestOptions)

	fullMessages := make([]StreamChatMessage, 0, len(messages)+1)
	if systemPrompt != "" {
		fullMessages = append(fullMessages, StreamChatMessage{
			Role:    "system",
			Content: systemPrompt,
		})
	}
	fullMessages = append(fullMessages, messages...)

	temperature := 0.7
	if s.config.Temperature != 0 {
		temperature = s.config.Temperature
	}
	maxTokens := 2048
	if s.config.MaxTokens != 0 {
		maxTokens = s.config.MaxTokens
	}

	reqMap := map[string]interface{}{
		"model":       s.config.OpenRouterModel,
		"messages":    fullMessages,
		"temperature": temperature,
		"max_tokens":  maxTokens,
		"stream":      true,
	}
	if reasoning := s.buildReasoningConfig(); reasoning != nil {
		reqMap["reasoning"] = reasoning
	}
	optionPayload, err := buildOpenRouterOptionPayload(requestOptions, true)
	if err != nil {
		return "", err
	}
	for key, value := range optionPayload {
		reqMap[key] = value
	}

	reqBody, err := json.Marshal(reqMap)
	if err != nil {
		return "", fmt.Errorf("batch: failed to marshal stream request: %w", err)
	}

	fullResponse, err := s.jsFetchStreaming(
		"https://openrouter.ai/api/v1/chat/completions",
		string(reqBody),
		s.config.OpenRouterAPIKey,
		onChunk,
		onReasoning,
	)
	if err != nil {
		return fullResponse, wrapStructuredOutputError(err, requestOptions)
	}

	return fullResponse, nil
}

// jsFetchStreaming performs a fetch with streaming SSE response parsing.
func (s *Service) jsFetchStreaming(
	url string,
	body string,
	apiKey string,
	onChunk func(string),
	onReasoning func(string),
) (string, error) {
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

	responseCh := make(chan struct {
		val js.Value
		err error
	}, 1)

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

	fetch.Invoke(url, options).Call("then", fetchThen).Call("catch", fetchCatch)

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
	if !response.Get("ok").Bool() {
		status := response.Get("status").Int()
		errCh := make(chan string, 1)
		errThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
			errMsg := args[0].String()
			go func() {
				errCh <- errMsg
			}()
			return nil
		})
		response.Call("text").Call("then", errThen)
		errText := <-errCh
		go func() {
			time.Sleep(50 * time.Millisecond)
			errThen.Release()
		}()
		return "", fmt.Errorf("HTTP %d: %s", status, errText)
	}

	bodyStream := response.Get("body")
	if bodyStream.IsNull() || bodyStream.IsUndefined() {
		return "", fmt.Errorf("batch: no response body for streaming")
	}
	reader := bodyStream.Call("getReader")
	decoder := js.Global().Get("TextDecoder").New("utf-8")

	var fullResponse strings.Builder
	var lineBuffer string

	chunkCh := make(chan struct {
		done  bool
		value js.Value
		err   error
	}, 1)

	readThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		result := args[0]
		done := result.Get("done").Bool()
		value := result.Get("value")

		go func() {
			chunkCh <- struct {
				done  bool
				value js.Value
				err   error
			}{
				done:  done,
				value: value,
				err:   nil,
			}
		}()
		return nil
	})

	readCatch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		errMsg := args[0].Get("message").String()
		go func() {
			chunkCh <- struct {
				done  bool
				value js.Value
				err   error
			}{
				done: true,
				err:  fmt.Errorf("read error: %s", errMsg),
			}
		}()
		return nil
	})

	defer func() {
		go func() {
			time.Sleep(50 * time.Millisecond)
			readThen.Release()
			readCatch.Release()
		}()
	}()

	for {
		reader.Call("read").Call("then", readThen).Call("catch", readCatch)

		chunkResult := <-chunkCh
		if chunkResult.err != nil {
			return fullResponse.String(), chunkResult.err
		}
		if chunkResult.done {
			break
		}

		decoded := decoder.Call("decode", chunkResult.value, map[string]interface{}{"stream": true}).String()
		lineBuffer += decoded
		lines := strings.Split(lineBuffer, "\n")
		lineBuffer = lines[len(lines)-1]

		for _, line := range lines[:len(lines)-1] {
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasPrefix(line, "data: ") {
				continue
			}

			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				return fullResponse.String(), nil
			}

			var sseData struct {
				Choices []struct {
					Delta struct {
						Content          string                   `json:"content"`
						Reasoning        string                   `json:"reasoning"`
						ReasoningContent string                   `json:"reasoning_content"`
						ReasoningDetails []map[string]interface{} `json:"reasoning_details"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if err := json.Unmarshal([]byte(data), &sseData); err != nil {
				continue
			}
			if len(sseData.Choices) == 0 {
				continue
			}

			delta := sseData.Choices[0].Delta
			if content := delta.Content; content != "" {
				fullResponse.WriteString(content)
				onChunk(content)
			}
			if reasoning := extractReasoningDelta(delta.Reasoning, delta.ReasoningContent, delta.ReasoningDetails); reasoning != "" && onReasoning != nil {
				onReasoning(reasoning)
			}
		}
	}

	return fullResponse.String(), nil
}

func extractReasoningDelta(reasoning string, reasoningContent string, details []map[string]interface{}) string {
	if strings.TrimSpace(reasoning) != "" {
		return reasoning
	}
	if strings.TrimSpace(reasoningContent) != "" {
		return reasoningContent
	}

	parts := make([]string, 0, len(details))
	for _, detail := range details {
		parts = append(parts, collectReasoningStrings(detail["text"])...)
		parts = append(parts, collectReasoningStrings(detail["summary"])...)
		parts = append(parts, collectReasoningStrings(detail["content"])...)
	}

	return strings.Join(parts, "\n")
}

func collectReasoningStrings(value interface{}) []string {
	switch typed := value.(type) {
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		return []string{trimmed}
	case []interface{}:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, collectReasoningStrings(item)...)
		}
		return parts
	case map[string]interface{}:
		parts := collectReasoningStrings(typed["text"])
		parts = append(parts, collectReasoningStrings(typed["summary"])...)
		parts = append(parts, collectReasoningStrings(typed["content"])...)
		return parts
	default:
		return nil
	}
}
