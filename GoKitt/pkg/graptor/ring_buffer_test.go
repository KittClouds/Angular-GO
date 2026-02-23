package graptor

import (
	"testing"
)

func TestRingBuffer_Push(t *testing.T) {
	rb := NewRingBuffer(3)

	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	// Should have all 3
	if rb.Len() != 3 {
		t.Errorf("Expected len 3, got %d", rb.Len())
	}

	// Push another, should overwrite oldest
	rb.Push("d")
	if rb.Len() != 3 {
		t.Errorf("Expected len 3, got %d", rb.Len())
	}

	// Check order (most recent first)
	slice := rb.ToSlice()
	if len(slice) != 3 {
		t.Fatalf("Expected 3 items, got %d", len(slice))
	}

	// Most recent should be "d"
	if slice[0] != "d" {
		t.Errorf("Expected first item 'd', got %q", slice[0])
	}
}

func TestRingBuffer_PushExisting(t *testing.T) {
	rb := NewRingBuffer(5)

	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	// Push existing item - should move to most recent
	rb.Push("a")

	slice := rb.ToSlice()
	if len(slice) != 3 {
		t.Fatalf("Expected 3 items, got %d", len(slice))
	}

	// "a" should now be most recent
	if slice[0] != "a" {
		t.Errorf("Expected 'a' to be most recent, got %q", slice[0])
	}

	// "c" should be second most recent
	if slice[1] != "c" {
		t.Errorf("Expected 'c' to be second, got %q", slice[1])
	}
}

func TestRingBuffer_ToSlice(t *testing.T) {
	rb := NewRingBuffer(5)

	// Empty buffer
	if slice := rb.ToSlice(); len(slice) != 0 {
		t.Errorf("Expected empty slice, got %v", slice)
	}

	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	slice := rb.ToSlice()

	// Order should be most recent first
	expected := []string{"c", "b", "a"}
	for i, v := range expected {
		if slice[i] != v {
			t.Errorf("Expected slice[%d] = %q, got %q", i, v, slice[i])
		}
	}
}

func TestRingBuffer_Contains(t *testing.T) {
	rb := NewRingBuffer(3)

	rb.Push("a")
	rb.Push("b")

	if !rb.Contains("a") {
		t.Error("Expected to contain 'a'")
	}
	if !rb.Contains("b") {
		t.Error("Expected to contain 'b'")
	}
	if rb.Contains("c") {
		t.Error("Expected NOT to contain 'c'")
	}
}

func TestRingBuffer_Clear(t *testing.T) {
	rb := NewRingBuffer(5)

	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	rb.Clear()

	if rb.Len() != 0 {
		t.Errorf("Expected len 0 after clear, got %d", rb.Len())
	}

	if slice := rb.ToSlice(); len(slice) != 0 {
		t.Errorf("Expected empty slice after clear, got %v", slice)
	}
}

func TestRingBuffer_GetMostRecent(t *testing.T) {
	rb := NewRingBuffer(5)

	if rb.GetMostRecent() != "" {
		t.Error("Expected empty string for empty buffer")
	}

	rb.Push("a")
	if rb.GetMostRecent() != "a" {
		t.Errorf("Expected 'a', got %q", rb.GetMostRecent())
	}

	rb.Push("b")
	if rb.GetMostRecent() != "b" {
		t.Errorf("Expected 'b', got %q", rb.GetMostRecent())
	}
}

func TestRingBuffer_GetLeastRecent(t *testing.T) {
	rb := NewRingBuffer(5)

	if rb.GetLeastRecent() != "" {
		t.Error("Expected empty string for empty buffer")
	}

	rb.Push("a")
	rb.Push("b")
	rb.Push("c")

	// Least recent should be "a"
	if rb.GetLeastRecent() != "a" {
		t.Errorf("Expected 'a', got %q", rb.GetLeastRecent())
	}

	// Push more to fill buffer
	rb.Push("d")
	rb.Push("e")
	rb.Push("f") // This overwrites "a"

	// Least recent should now be "b"
	if rb.GetLeastRecent() != "b" {
		t.Errorf("Expected 'b', got %q", rb.GetLeastRecent())
	}
}

func TestRingBuffer_WrapAround(t *testing.T) {
	rb := NewRingBuffer(3)

	// Fill buffer
	rb.Push("a") // [a, _, _]
	rb.Push("b") // [a, b, _]
	rb.Push("c") // [a, b, c]

	// Push more to cause wrap-around
	rb.Push("d") // [d, b, c] - overwrites a
	rb.Push("e") // [d, e, c] - overwrites b
	rb.Push("f") // [d, e, f] - overwrites c

	slice := rb.ToSlice()
	expected := []string{"f", "e", "d"}

	for i, v := range expected {
		if slice[i] != v {
			t.Errorf("Expected slice[%d] = %q, got %q", i, v, slice[i])
		}
	}
}

func TestRingBuffer_Concurrent(t *testing.T) {
	rb := NewRingBuffer(100)
	done := make(chan bool)

	// Concurrent writers
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 100; j++ {
				rb.Push(string(rune('A' + id)))
			}
			done <- true
		}(i)
	}

	// Concurrent readers
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				_ = rb.ToSlice()
				_ = rb.Contains("a")
				_ = rb.Len()
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 15; i++ {
		<-done
	}
}

func BenchmarkRingBuffer_Push(b *testing.B) {
	rb := NewRingBuffer(100)
	for i := 0; i < b.N; i++ {
		rb.Push(string(rune('A' + i%26)))
	}
}

func BenchmarkSlice_Push(b *testing.B) {
	// Compare with slice-based approach
	var slice []string
	maxLen := 100
	for i := 0; i < b.N; i++ {
		item := string(rune('A' + i%26))

		// Remove existing (O(n))
		for j, s := range slice {
			if s == item {
				slice = append(slice[:j], slice[j+1:]...)
				break
			}
		}

		// Prepend (O(n))
		slice = append([]string{item}, slice...)

		// Trim
		if len(slice) > maxLen {
			slice = slice[:maxLen]
		}
	}
}
