package helpers

import (
	"github.com/kittclouds/gokitt/pkg/scanner/chunker"
)

// FindPrevNP searches backward for the nearest NounPhrase
func FindPrevNP(chunks []chunker.Chunk, currentIdx int) *chunker.Chunk {
	for i := currentIdx - 1; i >= 0; i-- {
		if chunks[i].Kind == chunker.NounPhrase {
			return &chunks[i]
		}
	}
	return nil
}

// FindNextNP searches forward for the nearest NounPhrase
func FindNextNP(chunks []chunker.Chunk, currentIdx int) *chunker.Chunk {
	for i := currentIdx + 1; i < len(chunks); i++ {
		if chunks[i].Kind == chunker.NounPhrase {
			return &chunks[i]
		}
	}
	return nil
}
