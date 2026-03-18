//go:build !js || !wasm
// +build !js !wasm

package batch

import "fmt"

// StreamChat is a stub for non-WASM builds.
func (s *Service) StreamChat(messagesJSON, systemPrompt, requestOptionsJSON string, onChunk func(string), onReasoning func(string)) (string, error) {
	return "", fmt.Errorf("batch: streaming chat requires WASM environment")
}
