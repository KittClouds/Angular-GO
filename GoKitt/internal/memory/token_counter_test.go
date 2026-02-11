package memory

import (
	"testing"
)

func TestEstimateTokens(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected int
	}{
		{
			name:     "empty string",
			text:     "",
			expected: 0,
		},
		{
			name:     "single char",
			text:     "a",
			expected: 1, // (1+3)/4 = 1
		},
		{
			name:     "four chars = 1 token",
			text:     "test",
			expected: 1, // (4+3)/4 = 1
		},
		{
			name:     "five chars = 2 tokens",
			text:     "tests",
			expected: 2, // (5+3)/4 = 2
		},
		{
			name:     "eight chars = 2 tokens",
			text:     "testtest",
			expected: 2, // (8+3)/4 = 2
		},
		{
			name:     "typical sentence ~25 tokens",
			text:     "The quick brown fox jumps over the lazy dog.",
			expected: 11, // 45 chars / 4 ≈ 11
		},
		{
			name:     "1000 chars = 250 tokens",
			text:     string(make([]byte, 1000)),
			expected: 250, // 1000/4 = 250
		},
		{
			name:     "4000 chars = 1000 tokens",
			text:     string(make([]byte, 4000)),
			expected: 1000, // 4000/4 = 1000
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EstimateTokens(tt.text)
			if got != tt.expected {
				t.Errorf("EstimateTokens(%q) = %d, want %d", tt.name, got, tt.expected)
			}
		})
	}
}

func TestEstimateMessagesTokens(t *testing.T) {
	messages := []MessageContent{
		{Role: "user", Content: "Hello world"},       // 11 chars = 3 tokens
		{Role: "assistant", Content: "Hi there!"},    // 9 chars = 3 tokens
		{Role: "user", Content: "How are you doing"}, // 17 chars = 5 tokens
	}

	total := EstimateMessagesTokens(messages)
	expected := 3 + 3 + 5 // 11 tokens total

	if total != expected {
		t.Errorf("EstimateMessagesTokens() = %d, want %d", total, expected)
	}
}

func TestEstimateTokensThresholdCheck(t *testing.T) {
	// Verify threshold comparison logic
	// ObserveThreshold = 1000 tokens ≈ 4000 chars
	// ReflectThreshold = 4000 tokens ≈ 16000 chars

	observeThreshold := 1000
	reflectThreshold := 4000

	// Small text: should not trigger observation
	smallText := string(make([]byte, 2000)) // 500 tokens
	if EstimateTokens(smallText) >= observeThreshold {
		t.Error("Small text should not exceed observe threshold")
	}

	// Medium text: should trigger observation but not reflection
	// 5000 chars = 1250 tokens (exceeds observe, below reflect)
	mediumText := string(make([]byte, 5000))
	tokens := EstimateTokens(mediumText)
	if tokens < observeThreshold {
		t.Errorf("Medium text (%d tokens) should exceed observe threshold (%d)", tokens, observeThreshold)
	}
	if tokens >= reflectThreshold {
		t.Errorf("Medium text (%d tokens) should not exceed reflect threshold (%d)", tokens, reflectThreshold)
	}

	// Large text: should trigger reflection
	// 20000 chars = 5000 tokens (exceeds reflect)
	largeText := string(make([]byte, 20000))
	if EstimateTokens(largeText) < reflectThreshold {
		t.Error("Large text should exceed reflect threshold")
	}
}
