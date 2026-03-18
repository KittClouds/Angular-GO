package extraction

import (
	"context"
	"fmt"

	"github.com/kittclouds/gokitt/pkg/batch"
)

// Service coordinates entity and relation extraction from text.
// It composes with batch.Service for the actual LLM completion call.
type Service struct {
	batch *batch.Service
}

// NewService creates an extraction service backed by the given batch service.
func NewService(b *batch.Service) *Service {
	return &Service{batch: b}
}

// ExtractFromNote performs a single LLM call to extract both entities and
// relations from the given text. knownEntities primes the LLM with existing
// entity labels for better relation extraction.
func (s *Service) ExtractFromNote(
	ctx context.Context,
	text string,
	knownEntities []string,
) (*ExtractionResult, error) {
	if s.batch == nil {
		return nil, fmt.Errorf("extraction: batch service not initialized")
	}
	if !s.batch.IsConfigured() {
		return nil, fmt.Errorf("extraction: LLM provider not configured")
	}

	text = truncateText(text)
	if text == "" {
		return &ExtractionResult{}, nil
	}

	userPrompt := BuildUserPrompt(text, knownEntities)

	var requestOptions *batch.RequestOptions
	if s.batch.SupportsStructuredOutput() {
		requestOptions = StructuredRequestOptions()
	}

	raw, err := s.batch.CompleteWithOptions(ctx, userPrompt, SystemPrompt, requestOptions)
	if err != nil {
		return nil, fmt.Errorf("extraction: LLM call failed: %w", err)
	}

	result, err := ParseResponse(raw)
	if err != nil {
		return nil, fmt.Errorf("extraction: parse failed: %w", err)
	}

	return result, nil
}

// ExtractEntitiesFromNote is a convenience wrapper that returns only entities.
// Internally calls ExtractFromNote with the full combined prompt.
func (s *Service) ExtractEntitiesFromNote(
	ctx context.Context,
	text string,
) ([]ExtractedEntity, error) {
	result, err := s.ExtractFromNote(ctx, text, nil)
	if err != nil {
		return nil, err
	}
	return result.Entities, nil
}

// ExtractRelationsFromNote is a convenience wrapper that returns only relations.
// Internally calls ExtractFromNote with the full combined prompt.
func (s *Service) ExtractRelationsFromNote(
	ctx context.Context,
	text string,
	knownEntities []string,
) ([]ExtractedRelation, error) {
	result, err := s.ExtractFromNote(ctx, text, knownEntities)
	if err != nil {
		return nil, err
	}
	return result.Relations, nil
}

// truncateText limits text length to MaxTextLength.
func truncateText(text string) string {
	if len(text) > MaxTextLength {
		return text[:MaxTextLength]
	}
	return text
}
