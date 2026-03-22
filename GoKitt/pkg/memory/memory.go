package memory

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/agent"
	"github.com/kittclouds/gokitt/pkg/gdr"
)

// Config defines the thresholds for observation and reflection.
type Config struct {
	Enabled              bool
	ObservationThreshold int // Tokens in unobserved messages before triggering observation
	ReflectionThreshold  int // Tokens in active observations before triggering reflection
	Model                string
	Workspace            WorkspaceConfig // Workspace tool sandbox config
}

// DefaultConfig returns the standard configuration.
func DefaultConfig() Config {
	return Config{
		Enabled:              true,
		ObservationThreshold: 2000,
		ReflectionThreshold:  4000,
		Model:                "google/gemini-2.0-flash", // Default fast model
		Workspace:            DefaultWorkspaceConfig(),
	}
}

// Observer manages the observational memory process.
type Observer struct {
	store     *store.SQLiteStore
	agent     *agent.Service
	cfg       Config
	workspace *Workspace // nil when GDR not yet hydrated
}

// NewObserver creates a new Observer.
func NewObserver(s *store.SQLiteStore, a *agent.Service, cfg Config) *Observer {
	return &Observer{
		store: s,
		agent: a,
		cfg:   cfg,
	}
}

// IsEnabled reports whether observational memory work should run.
func (o *Observer) IsEnabled() bool {
	return o != nil && o.cfg.Enabled && o.agent != nil
}

// NewObserverWithGDR creates an Observer with GDR-backed workspace tools.
func NewObserverWithGDR(s *store.SQLiteStore, a *agent.Service, g *gdr.GateDrivenRetriever, cfg Config) *Observer {
	ws := NewWorkspace(s, g, cfg.Workspace)
	return &Observer{
		store:     s,
		agent:     a,
		cfg:       cfg,
		workspace: ws,
	}
}

// SetGDR wires a GDR index into the Observer workspace after initialization.
// Safe to call at any time — replaces the existing workspace instance.
func (o *Observer) SetGDR(g *gdr.GateDrivenRetriever) {
	o.workspace = NewWorkspace(o.store, g, o.cfg.Workspace)
}

// ProcessLoop is the main entry point to check and update memory for a thread.
// It should be called asynchronously after messages are added to the thread.
func (o *Observer) ProcessLoop(ctx context.Context, threadID string) error {
	if !o.cfg.Enabled {
		return nil
	}

	// 1. Load Context
	record, err := o.store.GetOMRecord(threadID)
	if err != nil {
		return fmt.Errorf("failed to get OM record: %w", err)
	}
	if record == nil {
		// Initialize new record
		record = &store.OMRecord{
			ThreadID:       threadID,
			CreatedAt:      time.Now().UnixMilli(),
			UpdatedAt:      time.Now().UnixMilli(),
			LastObservedAt: 0,
		}
		if err := o.store.UpsertOMRecord(record); err != nil {
			return fmt.Errorf("failed to create OM record: %w", err)
		}
	}

	// 2. Load Unobserved Messages
	messages, err := o.store.GetUnobservedMessages(threadID, record.LastObservedAt)
	if err != nil {
		return fmt.Errorf("failed to get unobserved messages: %w", err)
	}

	if len(messages) == 0 {
		return nil
	}

	// 3. Check Threshold
	tokenCount := o.countTokens(messages)
	if tokenCount < o.cfg.ObservationThreshold {
		return nil // Not enough new content to observe yet
	}

	// 4. Observe (LLM)
	if err := o.performObservation(ctx, record, messages); err != nil {
		return fmt.Errorf("observation failed: %w", err)
	}

	// 5. Reflect (Compression) - if needed
	// Re-fetch record as it was updated by performObservation
	record, err = o.store.GetOMRecord(threadID)
	if err != nil {
		return err
	}

	obsTokenCount := o.approxTokenCount(record.Observations)
	if obsTokenCount > o.cfg.ReflectionThreshold {
		if err := o.performReflection(ctx, record); err != nil {
			return fmt.Errorf("reflection failed: %w", err)
		}
	}

	return nil
}

// performObservation calls the LLM to summarize new messages into the memory.
func (o *Observer) performObservation(ctx context.Context, record *store.OMRecord, newMessages []*store.ThreadMessage) error {
	// Construct the prompt
	prompt := o.buildObserverPrompt(record, newMessages)

	// Use the new system prompt from prompts.go
	sysPrompt := BuildObserverSystemPrompt()

	resp, err := o.agent.Chat(ctx, prompt, sysPrompt)
	if err != nil {
		return err
	}
	if resp.Content == nil {
		return fmt.Errorf("nil response from observer agent")
	}

	// Parse Output using XML tags
	result := o.parseObserverOutput(*resp.Content)

	// Update Record
	// Replaces existing observations with the new/rewritten ones
	record.Observations = result.Observations
	if result.CurrentTask != "" {
		record.CurrentTask = result.CurrentTask
	}
	// SuggestedResponse is not currently stored in OMRecord but could be used by the agent in the next turn
	// We might want to persist it if we add a field for it later.

	// Update LastObservedAt
	if len(newMessages) > 0 {
		lastMsg := newMessages[len(newMessages)-1]
		record.LastObservedAt = lastMsg.CreatedAt
	}
	record.UpdatedAt = time.Now().UnixMilli()
	record.ObsTokenCount = o.approxTokenCount(record.Observations)

	return o.store.UpsertOMRecord(record)
}

// performReflection calls the LLM to compress the observations.
func (o *Observer) performReflection(ctx context.Context, record *store.OMRecord) error {
	prompt := o.buildReflectorPrompt(record.Observations)

	// Use the new Reflector system prompt
	sysPrompt := BuildReflectorSystemPrompt()

	resp, err := o.agent.Chat(ctx, prompt, sysPrompt)
	if err != nil {
		return err
	}
	if resp.Content == nil {
		return fmt.Errorf("nil response from reflector agent")
	}

	// Parse Output using same XML parser (structure is compatible)
	result := o.parseObserverOutput(*resp.Content)

	// Log Generation History
	gen := &store.OMGeneration{
		ID:           generateID(),
		ThreadID:     record.ThreadID,
		Generation:   record.GenerationNum + 1,
		InputTokens:  o.approxTokenCount(record.Observations),
		OutputTokens: o.approxTokenCount(result.Observations),
		InputText:    record.Observations,
		OutputText:   result.Observations,
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := o.store.AddOMGeneration(gen); err != nil {
		return fmt.Errorf("failed to save generation stats: %w", err)
	}

	// Update Record
	record.Observations = result.Observations
	if result.CurrentTask != "" {
		record.CurrentTask = result.CurrentTask
	}
	record.ObsTokenCount = gen.OutputTokens
	record.GenerationNum++
	record.UpdatedAt = time.Now().UnixMilli()

	return o.store.UpsertOMRecord(record)
}

// Helpers

func (o *Observer) countTokens(msgs []*store.ThreadMessage) int {
	count := 0
	for _, m := range msgs {
		count += len(m.Content) / 4
	}
	return count
}

func (o *Observer) approxTokenCount(text string) int {
	return len(text) / 4
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// parseObserverOutput extracts the structured data from the LLM's XML response.
type ObserverResult struct {
	Observations      string
	CurrentTask       string
	SuggestedResponse string
}

func (o *Observer) parseObserverOutput(content string) ObserverResult {
	var result ObserverResult

	// Extract <observations>
	obsRegex := regexp.MustCompile(`(?is)<observations>(.*?)</observations>`)
	if match := obsRegex.FindStringSubmatch(content); len(match) > 1 {
		result.Observations = strings.TrimSpace(match[1])
	} else {
		// Fallback: entire content if no tags
		result.Observations = strings.TrimSpace(content)
	}

	// Extract <current-task>
	taskRegex := regexp.MustCompile(`(?is)<current-task>(.*?)</current-task>`)
	if match := taskRegex.FindStringSubmatch(content); len(match) > 1 {
		result.CurrentTask = strings.TrimSpace(match[1])
	}

	// Extract <suggested-response>
	suggRegex := regexp.MustCompile(`(?is)<suggested-response>(.*?)</suggested-response>`)
	if match := suggRegex.FindStringSubmatch(content); len(match) > 1 {
		result.SuggestedResponse = strings.TrimSpace(match[1])
	}

	return result
}

// Prompts

func (o *Observer) buildObserverPrompt(record *store.OMRecord, newMessages []*store.ThreadMessage) string {
	var msgText strings.Builder
	for _, m := range newMessages {
		timestamp := time.UnixMilli(m.CreatedAt).Format("Jan 02 15:04")
		msgText.WriteString(fmt.Sprintf("**%s (%s):**\n%s\n\n", strings.Title(m.Role), timestamp, m.Content))
	}

	var prompt strings.Builder
	if record.Observations != "" {
		prompt.WriteString("## Previous Observations\n\n")
		prompt.WriteString(record.Observations)
		prompt.WriteString("\n\n---\n\n")
		prompt.WriteString("Do not repeat these existing observations. Your new observations will be appended to the existing observations.\n\n")
	}

	prompt.WriteString("## New Message History to Observe\n\n")
	prompt.WriteString(msgText.String())
	prompt.WriteString("\n---\n\n")

	prompt.WriteString("## Your Task\n\n")
	prompt.WriteString("Extract new observations from the message history above. Do not repeat observations that are already in the previous observations. Add your new observations in the format specified in your instructions.")

	return prompt.String()
}

func (o *Observer) buildReflectorPrompt(observations string) string {
	return fmt.Sprintf(`## OBSERVATIONS TO REFLECT ON

%s

---

Please analyze these observations and produce a refined, condensed version that will become the assistant's entire memory going forward.`, observations)
}
