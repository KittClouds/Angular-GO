//go:build js && wasm
// +build js,wasm

package batch

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"
)

// StreamChatMessage represents a message in the streaming chat request.
type StreamChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StreamChat performs a streaming OpenRouter API call.
// It calls onChunk(chunk string) for each SSE delta, and returns the full response.
func (s *Service) StreamChat(
	messagesJSON string,
	systemPrompt string,
	onChunk func(chunk string),
) (string, error) {
	if !s.IsConfigured() {
		return "", fmt.Errorf("batch: provider not configured")
	}
	if s.config.Provider != ProviderOpenRouter {
		return "", fmt.Errorf("batch: streaming chat only supported via OpenRouter")
	}

	// Parse messages
	var messages []StreamChatMessage
	if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
		return "", fmt.Errorf("batch: invalid messages JSON: %w", err)
	}

	// Prepend system prompt
	fullMessages := make([]StreamChatMessage, 0, len(messages)+1)
	if systemPrompt != "" {
		fullMessages = append(fullMessages, StreamChatMessage{
			Role:    "system",
			Content: systemPrompt,
		})
	}
	fullMessages = append(fullMessages, messages...)

	// Build request body with stream: true
	reqMap := map[string]interface{}{
		"model":       s.config.OpenRouterModel,
		"messages":    fullMessages,
		"temperature": 0.7,
		"max_tokens":  2048,
		"stream":      true,
	}
	reqBody, err := json.Marshal(reqMap)
	if err != nil {
		return "", fmt.Errorf("batch: failed to marshal stream request: %w", err)
	}

	return s.jsFetchStreaming(
		"https://openrouter.ai/api/v1/chat/completions",
		string(reqBody),
		s.config.OpenRouterAPIKey,
		onChunk,
	)
}

// jsFetchStreaming performs a fetch with streaming SSE response parsing.
// Uses a channel-per-chunk pattern to flatten JS promise chains into Go control flow.
func (s *Service) jsFetchStreaming(url, body, apiKey string, onChunk func(string)) (string, error) {
	fetch := js.Global().Get("fetch")
	if fetch.IsUndefined() {
		return "", fmt.Errorf("batch: fetch not available")
	}

	origin := js.Global().Get("location").Get("origin").String()

	// Build request options
	headers := js.Global().Get("Object").New()
	headers.Set("Content-Type", "application/json")
	headers.Set("Authorization", fmt.Sprintf("Bearer %s", apiKey))
	headers.Set("HTTP-Referer", origin)
	headers.Set("X-Title", "KittClouds")

	options := js.Global().Get("Object").New()
	options.Set("method", "POST")
	options.Set("headers", headers)
	options.Set("body", body)

	// Step 1: Await the fetch() promise to get the Response object
	responseCh := make(chan struct {
		val js.Value
		err error
	}, 1)

	fetchThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		responseCh <- struct {
			val js.Value
			err error
		}{args[0], nil}
		return nil
	})
	defer fetchThen.Release()

	fetchCatch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		responseCh <- struct {
			val js.Value
			err error
		}{js.Undefined(), fmt.Errorf("fetch: %s", args[0].Get("message").String())}
		return nil
	})
	defer fetchCatch.Release()

	fetch.Invoke(url, options).Call("then", fetchThen).Call("catch", fetchCatch)

	fetchResult := <-responseCh
	if fetchResult.err != nil {
		return "", fetchResult.err
	}

	response := fetchResult.val

	// Check HTTP status
	if !response.Get("ok").Bool() {
		status := response.Get("status").Int()
		// Read error body
		errCh := make(chan string, 1)
		errThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
			errCh <- args[0].String()
			return nil
		})
		defer errThen.Release()
		response.Call("text").Call("then", errThen)
		errText := <-errCh
		return "", fmt.Errorf("HTTP %d: %s", status, errText)
	}

	// Step 2: Get the ReadableStream reader
	bodyStream := response.Get("body")
	if bodyStream.IsNull() || bodyStream.IsUndefined() {
		return "", fmt.Errorf("batch: no response body for streaming")
	}
	reader := bodyStream.Call("getReader")
	decoder := js.Global().Get("TextDecoder").New("utf-8")

	// Step 3: Read chunks in a loop using channels
	var fullResponse strings.Builder
	var lineBuffer string

	chunkCh := make(chan struct {
		done  bool
		value js.Value
		err   error
	}, 1)

	readThen := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		result := args[0]
		chunkCh <- struct {
			done  bool
			value js.Value
			err   error
		}{
			done:  result.Get("done").Bool(),
			value: result.Get("value"),
			err:   nil,
		}
		return nil
	})
	defer readThen.Release()

	readCatch := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		chunkCh <- struct {
			done  bool
			value js.Value
			err   error
		}{
			done: true,
			err:  fmt.Errorf("read error: %s", args[0].Get("message").String()),
		}
		return nil
	})
	defer readCatch.Release()

	for {
		reader.Call("read").Call("then", readThen).Call("catch", readCatch)

		chunkResult := <-chunkCh

		if chunkResult.err != nil {
			return fullResponse.String(), chunkResult.err
		}
		if chunkResult.done {
			break
		}

		// Decode the Uint8Array to string
		decoded := decoder.Call("decode", chunkResult.value, map[string]interface{}{"stream": true}).String()

		// Buffer lines and process complete ones
		lineBuffer += decoded
		lines := strings.Split(lineBuffer, "\n")
		lineBuffer = lines[len(lines)-1] // Keep incomplete last line

		for _, line := range lines[:len(lines)-1] {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				return fullResponse.String(), nil
			}

			// Parse SSE JSON chunk
			var sseData struct {
				Choices []struct {
					Delta struct {
						Content string `json:"content"`
					} `json:"delta"`
				} `json:"choices"`
			}
			if err := json.Unmarshal([]byte(data), &sseData); err != nil {
				continue
			}
			if len(sseData.Choices) > 0 {
				content := sseData.Choices[0].Delta.Content
				if content != "" {
					fullResponse.WriteString(content)
					onChunk(content)
				}
			}
		}
	}

	return fullResponse.String(), nil
}
