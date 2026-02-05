package discovery

import (
	"strings"

	implicitmatcher "github.com/kittclouds/gokitt/pkg/implicit-matcher"
	"github.com/orsinium-labs/stopwords"
)

// CandidateStatus tracks the lifecycle of a discovery candidate
type CandidateStatus int

const (
	StatusWatching CandidateStatus = iota
	StatusPromoted
	StatusIgnored
)

// nerStopwords - Common capitalized words that are NOT named entities
// These bypass the standard English stopwords list because they're often:
// - Adjectives at sentence start (Beautiful, Pure, Huge)
// - Verbs at line start (Loves, Hates, Tease)
// - Abstract nouns too generic for entities (Conflict, Resolution, Trauma)
// - Document structure words (Profiles, Species, Height)
var nerStopwords = map[string]bool{
	// Adjectives (often sentence-initial)
	"beautiful": true, "pure": true, "huge": true, "tiny": true,
	"visual": true, "biological": true, "kinetic": true, "dynamic": true,
	"solar": true, "pale": true, "white": true, "red": true, "yellow": true,
	"blonde": true, "amber": true, "tall": true, "big": true, "small": true,
	"great": true, "good": true, "bad": true, "new": true, "old": true,
	"tight": true, "loose": true, "bright": true, "dark": true, "light": true,
	"heavy": true, "dense": true, "lean": true, "fit": true, "solid": true,
	"cute": true, "pretty": true, "handsome": true, "ugly": true,
	"serious": true, "funny": true, "scary": true, "creepy": true,
	"loud": true, "quiet": true, "soft": true, "hard": true,
	"long": true, "short": true, "wide": true, "narrow": true,
	"fast": true, "slow": true, "quick": true, "gentle": true,
	"scrappy": true, "grumpy": true, "manic": true, "calm": true,

	// Verbs/Actions (often at line starts in character sheets)
	"tease": true, "loves": true, "hates": true, "hides": true, "flaunts": true,
	"snaps": true, "eat": true, "spank": true, "move": true, "step": true,
	"walk": true, "run": true, "jump": true, "fly": true, "float": true,
	"hide": true, "show": true, "look": true, "see": true, "watch": true,
	"give": true, "take": true, "make": true, "get": true, "let": true,
	"try": true, "want": true, "need": true, "use": true, "find": true,
	"keep": true, "put": true, "think": true, "say": true, "tell": true,

	// Abstract nouns (too generic for entities)
	"conflict": true, "resolution": true, "trauma": true, "biology": true,
	"chaos": true, "contrast": true, "interaction": true, "dynamics": true,
	"fun": true, "reality": true, "bond": true, "core": true, "void": true,
	"disaster": true, "disasters": true, "friction": true, "tension": true,
	"love": true, "hate": true, "fear": true, "anger": true, "joy": true,
	"power": true, "strength": true, "weakness": true, "energy": true,
	"life": true, "death": true, "time": true, "space": true,

	// Document structure words (often in RPG character sheets)
	"profiles": true, "archetypes": true, "summary": true, "height": true,
	"species": true, "handler": true, "controller": true, "floater": true,
	"factions": true, "lineage": true, "variant": true, "traits": true,
	"visuals": true, "vibe": true, "notes": true, "section": true,
	"chapter": true, "introduction": true, "conclusion": true,
	"hair": true, "eyes": true, "wings": true, "skin": true, "horns": true,

	// Common relationship/role descriptors
	"sister": true, "brother": true, "mother": true, "father": true,
	"daughter": true, "son": true, "cousin": true, "twin": true,
	"friend": true, "enemy": true, "rival": true, "ally": true,
	"leader": true, "member": true, "general": true, "captain": true,
	"girl": true, "boy": true, "man": true, "woman": true,
}

// CandidateStats tracks info about a potential entity
type CandidateStats struct {
	Count        int
	Status       CandidateStatus
	InferredKind *implicitmatcher.EntityKind // Pointer to allow nil (unknown)
	Display      string                      // Best display form seen
}

// CandidateRegistry tracks potential new entities
type CandidateRegistry struct {
	Stats              map[CanonicalToken]*CandidateStats
	PromotionThreshold int
	StopWords          map[string]bool      // Custom stopwords
	stopwordChecker    *stopwords.Stopwords // Robust English stopwords

	// Simplify graph for now: just track co-occurrence counts?
	// Or just ignore for MVP.
}

// NewRegistry creates a new registry
func NewRegistry(threshold int) *CandidateRegistry {
	r := &CandidateRegistry{
		Stats:              make(map[CanonicalToken]*CandidateStats),
		PromotionThreshold: threshold,
		StopWords:          make(map[string]bool),
		stopwordChecker:    stopwords.MustGet("en"),
	}

	// Also load our dafsa stopwords as a backup
	for w := range implicitmatcher.StopWords {
		r.StopWords[w] = true
	}

	return r
}

// AddStopWord adds a custom ignored word
func (r *CandidateRegistry) AddStopWord(word string) {
	r.StopWords[strings.ToLower(word)] = true
}

// AddToken processes a token. Returns true if promoted this time.
func (r *CandidateRegistry) AddToken(raw string) bool {
	key, display, valid := Canonicalize(raw)
	if !valid {
		return false
	}

	// 1. Check custom stopwords map
	if r.StopWords[string(key)] {
		return false
	}

	// 2. Check robust stopwords library
	if r.stopwordChecker != nil && r.stopwordChecker.Contains(string(key)) {
		return false
	}

	// 3. Check NER-specific stopwords (common capitalized words)
	if nerStopwords[string(key)] {
		return false
	}

	// 4. Get/Create stats
	stats, exists := r.Stats[key]
	if !exists {
		stats = &CandidateStats{
			Count:   0,
			Status:  StatusWatching,
			Display: display,
		}
		r.Stats[key] = stats
	}

	// If already ignored/promoted, just increment
	if stats.Status != StatusWatching {
		stats.Count++
		return false
	}

	stats.Count++

	// 3. Check threshold
	if stats.Count >= r.PromotionThreshold {
		stats.Status = StatusPromoted
		return true
	}

	return false
}

// GetStatus returns the status of a token
func (r *CandidateRegistry) GetStatus(raw string) CandidateStatus {
	key, _, valid := Canonicalize(raw)
	if !valid {
		return StatusIgnored
	}
	if s, ok := r.Stats[key]; ok {
		return s.Status
	}
	return StatusWatching // Default (conceptually unknown)
}

// ProposeInference updates the inferred kind
func (r *CandidateRegistry) ProposeInference(raw string, kind implicitmatcher.EntityKind) {
	key, _, valid := Canonicalize(raw)
	if !valid {
		return
	}

	if stats, ok := r.Stats[key]; ok {
		// Only set if currently unknown (nil)
		if stats.InferredKind == nil {
			k := kind // copy value to heap
			stats.InferredKind = &k
		}
	}
}

// GetStats helper
func (r *CandidateRegistry) GetStats(raw string) *CandidateStats {
	key, _, _ := Canonicalize(raw)
	return r.Stats[key]
}

// Candidate is a public view of a discovery candidate
type Candidate struct {
	Token  string  `json:"token"`
	Count  int     `json:"count"`
	Status int     `json:"status"`
	Kind   string  `json:"kind"`
	Score  float64 `json:"score"`
}

// GetCandidates returns all tracked candidates
func (r *CandidateRegistry) GetCandidates() []Candidate {
	var list []Candidate
	for _, stats := range r.Stats {
		kindStr := "UNKNOWN"
		if stats.InferredKind != nil {
			kindStr = stats.InferredKind.String()
		}

		list = append(list, Candidate{
			Token:  stats.Display,
			Count:  stats.Count,
			Status: int(stats.Status),
			Kind:   kindStr,
			Score:  float64(stats.Count),
		})
	}
	return list
}
