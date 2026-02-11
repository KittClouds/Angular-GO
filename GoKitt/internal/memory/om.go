// Package memory provides the Observational Memory pipeline for GoKitt.
// Implements the three-agent architecture: Observer → Reflector → Actor.
package memory

import (
	"fmt"
	"sync"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
)

// Default thresholds
const (
	DefaultObserveThreshold = 1000 // ~4k chars / ~5-6 messages
	DefaultReflectThreshold = 4000 // ~16k chars
	DefaultMaxRetries       = 2
)

// ProcessResult represents the result of a Process call.
type ProcessResult struct {
	Observed  bool `json:"observed"`  // Whether observation occurred
	Reflected bool `json:"reflected"` // Whether reflection occurred
}

// OMOrchestrator coordinates the Observer → Reflector → Actor pipeline.
type OMOrchestrator struct {
	store     store.Storer
	observer  *Observer
	reflector *Reflector
	config    store.OMConfig
	mu        sync.Mutex // Prevent concurrent observe/reflect
}

// NewOMOrchestrator creates a new OM orchestrator.
func NewOMOrchestrator(s store.Storer, llm LLMClient, config store.OMConfig) *OMOrchestrator {
	// Apply defaults
	if config.ObserveThreshold <= 0 {
		config.ObserveThreshold = DefaultObserveThreshold
	}
	if config.ReflectThreshold <= 0 {
		config.ReflectThreshold = DefaultReflectThreshold
	}
	if config.MaxRetries <= 0 {
		config.MaxRetries = DefaultMaxRetries
	}

	return &OMOrchestrator{
		store:     s,
		observer:  NewObserver(llm),
		reflector: NewReflector(llm, config.MaxRetries),
		config:    config,
	}
}

// Process is called after every message add.
// Returns true if observation or reflection occurred.
func (om *OMOrchestrator) Process(threadID string) (*ProcessResult, error) {
	// Skip if OM is disabled
	if !om.config.Enabled {
		return &ProcessResult{}, nil
	}

	om.mu.Lock()
	defer om.mu.Unlock()

	result := &ProcessResult{}

	// Load or create OM record
	record, err := om.store.GetOMRecord(threadID)
	if err != nil {
		return nil, fmt.Errorf("om: failed to get record: %w", err)
	}
	if record == nil {
		now := time.Now().Unix()
		record = &store.OMRecord{
			ThreadID:       threadID,
			Observations:   "",
			CurrentTask:    "",
			LastObservedAt: 0,
			ObsTokenCount:  0,
			GenerationNum:  0,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
	}

	// Load unobserved messages
	messages, err := om.store.GetThreadMessages(threadID)
	if err != nil {
		return nil, fmt.Errorf("om: failed to get messages: %w", err)
	}

	// Filter to unobserved messages
	var unobserved []MessageContent
	for _, msg := range messages {
		if msg.CreatedAt > record.LastObservedAt {
			unobserved = append(unobserved, MessageContent{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
	}

	if len(unobserved) == 0 {
		return result, nil
	}

	// Check if we should observe
	unobservedTokens := EstimateMessagesTokens(unobserved)
	if unobservedTokens < om.config.ObserveThreshold {
		return result, nil
	}

	// Observe
	obsResult, err := om.observer.Observe(unobserved, record.Observations)
	if err != nil {
		return nil, fmt.Errorf("om: observation failed: %w", err)
	}
	result.Observed = true

	// Update record
	record.Observations = obsResult.Observations
	record.CurrentTask = obsResult.CurrentTask
	record.LastObservedAt = messages[len(messages)-1].CreatedAt // Latest message timestamp
	record.ObsTokenCount = EstimateTokens(record.Observations)
	record.UpdatedAt = time.Now().Unix()

	// Check if we should reflect
	if record.ObsTokenCount >= om.config.ReflectThreshold {
		reflectResult, err := om.reflector.Reflect(record.Observations, om.config.ReflectThreshold/2)
		if err != nil {
			// Log but don't fail - observation is still valid
			fmt.Printf("om: reflection failed: %v\n", err)
		} else {
			result.Reflected = true

			// Record generation history
			genID := fmt.Sprintf("gen-%s-%d", threadID, record.GenerationNum+1)
			now := time.Now().Unix()
			om.store.AddOMGeneration(&store.OMGeneration{
				ID:           genID,
				ThreadID:     threadID,
				Generation:   record.GenerationNum + 1,
				InputTokens:  record.ObsTokenCount,
				OutputTokens: reflectResult.TokenCount,
				InputText:    record.Observations,
				OutputText:   reflectResult.Condensed,
				CreatedAt:    now,
			})

			// Update record with condensed observations
			record.Observations = reflectResult.Condensed
			record.ObsTokenCount = reflectResult.TokenCount
			record.GenerationNum++
			record.UpdatedAt = now
		}
	}

	// Save record
	if err := om.store.UpsertOMRecord(record); err != nil {
		return nil, fmt.Errorf("om: failed to save record: %w", err)
	}

	return result, nil
}

// GetContext returns formatted observations for system prompt injection.
func (om *OMOrchestrator) GetContext(threadID string) (string, error) {
	if !om.config.Enabled {
		return "", nil
	}

	record, err := om.store.GetOMRecord(threadID)
	if err != nil {
		return "", fmt.Errorf("om: failed to get record: %w", err)
	}
	if record == nil || record.Observations == "" {
		return "", nil
	}

	// Format for system prompt
	context := "<observations>\n"
	context += record.Observations
	if record.CurrentTask != "" {
		context += fmt.Sprintf("\n\nCurrent task: %s", record.CurrentTask)
	}
	context += "\n</observations>"

	return context, nil
}

// Observe manually triggers observation (bypass threshold).
func (om *OMOrchestrator) Observe(threadID string) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	record, err := om.store.GetOMRecord(threadID)
	if err != nil {
		return fmt.Errorf("om: failed to get record: %w", err)
	}
	if record == nil {
		now := time.Now().Unix()
		record = &store.OMRecord{
			ThreadID:  threadID,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	messages, err := om.store.GetThreadMessages(threadID)
	if err != nil {
		return fmt.Errorf("om: failed to get messages: %w", err)
	}

	var unobserved []MessageContent
	for _, msg := range messages {
		if msg.CreatedAt > record.LastObservedAt {
			unobserved = append(unobserved, MessageContent{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
	}

	if len(unobserved) == 0 {
		return nil
	}

	obsResult, err := om.observer.Observe(unobserved, record.Observations)
	if err != nil {
		return fmt.Errorf("om: observation failed: %w", err)
	}

	record.Observations = obsResult.Observations
	record.CurrentTask = obsResult.CurrentTask
	if len(messages) > 0 {
		record.LastObservedAt = messages[len(messages)-1].CreatedAt
	}
	record.ObsTokenCount = EstimateTokens(record.Observations)
	record.UpdatedAt = time.Now().Unix()

	return om.store.UpsertOMRecord(record)
}

// Reflect manually triggers reflection (bypass threshold).
func (om *OMOrchestrator) Reflect(threadID string) error {
	om.mu.Lock()
	defer om.mu.Unlock()

	record, err := om.store.GetOMRecord(threadID)
	if err != nil {
		return fmt.Errorf("om: failed to get record: %w", err)
	}
	if record == nil || record.Observations == "" {
		return nil
	}

	reflectResult, err := om.reflector.Reflect(record.Observations, om.config.ReflectThreshold/2)
	if err != nil {
		return fmt.Errorf("om: reflection failed: %w", err)
	}

	genID := fmt.Sprintf("gen-%s-%d", threadID, record.GenerationNum+1)
	now := time.Now().Unix()
	om.store.AddOMGeneration(&store.OMGeneration{
		ID:           genID,
		ThreadID:     threadID,
		Generation:   record.GenerationNum + 1,
		InputTokens:  record.ObsTokenCount,
		OutputTokens: reflectResult.TokenCount,
		InputText:    record.Observations,
		OutputText:   reflectResult.Condensed,
		CreatedAt:    now,
	})

	record.Observations = reflectResult.Condensed
	record.ObsTokenCount = reflectResult.TokenCount
	record.GenerationNum++
	record.UpdatedAt = now

	return om.store.UpsertOMRecord(record)
}

// Clear resets OM state for a thread.
func (om *OMOrchestrator) Clear(threadID string) error {
	return om.store.DeleteOMRecord(threadID)
}

// GetRecord returns the current OM record for a thread.
func (om *OMOrchestrator) GetRecord(threadID string) (*store.OMRecord, error) {
	return om.store.GetOMRecord(threadID)
}

// SetConfig updates the OM configuration.
func (om *OMOrchestrator) SetConfig(config store.OMConfig) {
	om.mu.Lock()
	defer om.mu.Unlock()
	om.config = config
}

// GetConfig returns the current OM configuration.
func (om *OMOrchestrator) GetConfig() store.OMConfig {
	om.mu.Lock()
	defer om.mu.Unlock()
	return om.config
}
