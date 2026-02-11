// Package memory provides the Observational Memory pipeline for GoKitt.
// Implements the three-agent architecture: Observer → Reflector → Actor.
package memory

// EstimateTokens estimates token count using the ~4 chars/token heuristic.
// Good enough for threshold comparison. Not billing-accurate.
// Based on GPT-4 tokenization patterns where English text averages ~4 chars per token.
func EstimateTokens(text string) int {
	if len(text) == 0 {
		return 0
	}
	// Round up: (len + 3) / 4
	return (len(text) + 3) / 4
}

// EstimateMessagesTokens estimates total tokens for a slice of messages.
// Sums content length for each message.
func EstimateMessagesTokens(messages []MessageContent) int {
	total := 0
	for _, m := range messages {
		total += EstimateTokens(m.Content)
	}
	return total
}

// MessageContent represents a message for token counting.
// Minimal fields needed for estimation.
type MessageContent struct {
	Role    string
	Content string
}
