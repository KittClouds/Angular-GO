// Package chat provides AI chat session management.
// Replaces TypeScript AiChatService with Go implementation using SQLite.
package chat

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
)

// ChatService manages AI chat sessions.
type ChatService struct {
	store store.Storer
}

// NewChatService creates a new chat service.
func NewChatService(s store.Storer) *ChatService {
	return &ChatService{
		store: s,
	}
}

// =============================================================================
// Thread (Session) Management
// =============================================================================

// CreateThread creates a new chat thread (session).
func (s *ChatService) CreateThread(worldID, narrativeID string) (*store.Thread, error) {
	now := time.Now().UnixMilli()
	thread := &store.Thread{
		ID:          generateID(),
		WorldID:     worldID,
		NarrativeID: narrativeID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := s.store.CreateThread(thread); err != nil {
		return nil, fmt.Errorf("failed to create thread: %w", err)
	}

	return thread, nil
}

// GetThread retrieves a thread by ID.
func (s *ChatService) GetThread(id string) (*store.Thread, error) {
	return s.store.GetThread(id)
}

// ListThreads returns all threads, optionally filtered by worldID.
func (s *ChatService) ListThreads(worldID string) ([]*store.Thread, error) {
	return s.store.ListThreads(worldID)
}

// DeleteThread removes a thread and all its messages.
func (s *ChatService) DeleteThread(id string) error {
	return s.store.DeleteThread(id)
}

// =============================================================================
// Message Operations
// =============================================================================

// AddMessage adds a message to a thread and optionally extracts memories.
func (s *ChatService) AddMessage(threadID, role, content, narrativeID string) (*store.ThreadMessage, error) {
	now := time.Now().UnixMilli()
	msg := &store.ThreadMessage{
		ID:          generateID(),
		ThreadID:    threadID,
		Role:        role,
		Content:     content,
		NarrativeID: narrativeID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := s.store.AddMessage(msg); err != nil {
		return nil, fmt.Errorf("failed to add message: %w", err)
	}

	return msg, nil
}

// AddUserMessage is a convenience method for adding user messages.
func (s *ChatService) AddUserMessage(threadID, content, narrativeID string) (*store.ThreadMessage, error) {
	return s.AddMessage(threadID, "user", content, narrativeID)
}

// AddAssistantMessage is a convenience method for adding assistant messages.
func (s *ChatService) AddAssistantMessage(threadID, content, narrativeID string) (*store.ThreadMessage, error) {
	return s.AddMessage(threadID, "assistant", content, narrativeID)
}

// GetMessages returns all messages for a thread.
func (s *ChatService) GetMessages(threadID string) ([]*store.ThreadMessage, error) {
	return s.store.GetThreadMessages(threadID)
}

// GetMessage retrieves a single message by ID.
func (s *ChatService) GetMessage(id string) (*store.ThreadMessage, error) {
	return s.store.GetMessage(id)
}

// UpdateMessage updates message content (for streaming finalization).
func (s *ChatService) UpdateMessage(messageID, content string) error {
	msg, err := s.store.GetMessage(messageID)
	if err != nil {
		return err
	}
	if msg == nil {
		return fmt.Errorf("message not found: %s", messageID)
	}

	msg.Content = content
	msg.UpdatedAt = time.Now().UnixMilli()
	msg.IsStreaming = false

	return s.store.UpdateMessage(msg)
}

// AppendMessageContent appends content to a message (for streaming).
func (s *ChatService) AppendMessageContent(messageID, chunk string) error {
	return s.store.AppendMessageContent(messageID, chunk)
}

// StartStreamingMessage creates a new assistant message in streaming state.
func (s *ChatService) StartStreamingMessage(threadID, narrativeID string) (*store.ThreadMessage, error) {
	now := time.Now().UnixMilli()
	msg := &store.ThreadMessage{
		ID:          generateID(),
		ThreadID:    threadID,
		Role:        "assistant",
		Content:     "",
		NarrativeID: narrativeID,
		CreatedAt:   now,
		UpdatedAt:   now,
		IsStreaming: true,
	}

	if err := s.store.AddMessage(msg); err != nil {
		return nil, fmt.Errorf("failed to create streaming message: %w", err)
	}

	return msg, nil
}

// ClearThread removes all messages from a thread.
func (s *ChatService) ClearThread(threadID string) error {
	return s.store.DeleteThreadMessages(threadID)
}

// =============================================================================
// Memory Integration
// =============================================================================

// GetMemories returns all memories for a thread.
func (s *ChatService) GetMemories(threadID string) ([]*store.Memory, error) {
	return s.store.GetMemoriesForThread(threadID)
}

// =============================================================================
// Export
// =============================================================================

// ExportThread exports a thread's messages as JSON string.
func (s *ChatService) ExportThread(threadID string) (string, error) {
	messages, err := s.store.GetThreadMessages(threadID)
	if err != nil {
		return "", err
	}

	// Simple JSON serialization
	result := "["
	for i, m := range messages {
		if i > 0 {
			result += ","
		}
		result += fmt.Sprintf(`{"id":"%s","role":"%s","content":"%s","createdAt":%d}`,
			m.ID, m.Role, escapeJSON(m.Content), m.CreatedAt)
	}
	result += "]"
	return result, nil
}

// =============================================================================
// Helpers
// =============================================================================

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func escapeJSON(s string) string {
	// Basic JSON escaping
	result := ""
	for _, c := range s {
		switch c {
		case '"':
			result += `\"`
		case '\\':
			result += `\\`
		case '\n':
			result += `\n`
		case '\r':
			result += `\r`
		case '\t':
			result += `\t`
		default:
			result += string(c)
		}
	}
	return result
}
