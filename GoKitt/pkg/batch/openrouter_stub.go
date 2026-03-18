//go:build !js && !wasm
// +build !js,!wasm

package batch

import (
	"context"
	"fmt"
)

// callOpenRouter is a stub for non-WASM builds.
func (s *Service) callOpenRouter(_ context.Context, _, _ string, _ *RequestOptions) (string, error) {
	return "", fmt.Errorf("batch: OpenRouter API calls require WASM environment")
}

// jsFetchWithAuth is a stub for non-WASM builds.
func (s *Service) jsFetchWithAuth(_, _, _ string) (string, error) {
	return "", fmt.Errorf("batch: fetch requires WASM environment")
}
