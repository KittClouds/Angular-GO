package analytics

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

type SentenceLengthDistribution struct {
	Count1      int `json:"1"`
	Count2To6   int `json:"2-6"`
	Count7To15  int `json:"7-15"`
	Count16To25 int `json:"16-25"`
	Count26To39 int `json:"26-39"`
	Count40Plus int `json:"40+"`
}

type FlowInsights struct {
	ConsecutivePatterns int    `json:"consecutivePatterns"`
	DominantRange       string `json:"dominantRange"`
	VarietyScore        int    `json:"varietyScore"`
	HasMonotony         bool   `json:"hasMonotony"`
}

type KeywordDensity struct {
	Word       string  `json:"word"`
	Count      int     `json:"count"`
	Percentage float64 `json:"percentage"`
}

type AnalyticsHighlightRange struct {
	From int    `json:"from"`
	To   int    `json:"to"`
	Text string `json:"text"`
}

type PhraseEchoItem struct {
	ID              string                    `json:"id"`
	Phrase          string                    `json:"phrase"`
	OccurrenceCount int                       `json:"occurrenceCount"`
	Severity        string                    `json:"severity"`
	Snippets        []string                  `json:"snippets"`
	HighlightRanges []AnalyticsHighlightRange `json:"highlightRanges"`
}

type RepetitionAnalysis struct {
	Items      []PhraseEchoItem `json:"items"`
	TotalFlags int              `json:"totalFlags"`
}

type ProximityConflictItem struct {
	ID              string                    `json:"id"`
	Root            string                    `json:"root"`
	SurfaceForms    []string                  `json:"surfaceForms"`
	PartOfSpeech    string                    `json:"partOfSpeech"`
	MinWordDistance int                       `json:"minWordDistance"`
	Severity        string                    `json:"severity"`
	Snippets        []string                  `json:"snippets"`
	HighlightRanges []AnalyticsHighlightRange `json:"highlightRanges"`
}

type ProximityAnalysis struct {
	Items      []ProximityConflictItem `json:"items"`
	TotalFlags int                     `json:"totalFlags"`
}

type CadenceSentence struct {
	ID             string `json:"id"`
	ParagraphIndex int    `json:"paragraphIndex"`
	SentenceIndex  int    `json:"sentenceIndex"`
	From           int    `json:"from"`
	To             int    `json:"to"`
	WordCount      int    `json:"wordCount"`
	Bucket         string `json:"bucket"`
	Snippet        string `json:"snippet"`
}

type CadenceHotspot struct {
	ID              string                    `json:"id"`
	Type            string                    `json:"type"`
	Label           string                    `json:"label"`
	Severity        string                    `json:"severity"`
	Explanation     string                    `json:"explanation"`
	SentenceIDs     []string                  `json:"sentenceIds"`
	HighlightRanges []AnalyticsHighlightRange `json:"highlightRanges"`
}

type CadenceAnalysis struct {
	Sentences []CadenceSentence `json:"sentences"`
	Hotspots  []CadenceHotspot  `json:"hotspots"`
}

type TextAnalytics struct {
	WordCount                  int                        `json:"wordCount"`
	CharacterCount             int                        `json:"characterCount"`
	CharacterCountNoSpaces     int                        `json:"characterCountNoSpaces"`
	SentenceCount              int                        `json:"sentenceCount"`
	ParagraphCount             int                        `json:"paragraphCount"`
	ReadingLevel               string                     `json:"readingLevel"`
	ReadingTimeMinutes         int                        `json:"readingTimeMinutes"`
	ReadingTimeSeconds         int                        `json:"readingTimeSeconds"`
	SpeakingTimeMinutes        int                        `json:"speakingTimeMinutes"`
	SpeakingTimeSeconds        int                        `json:"speakingTimeSeconds"`
	AverageSentenceLength      float64                    `json:"averageSentenceLength"`
	SentenceLengthVariation    float64                    `json:"sentenceLengthVariation"`
	FlowScore                  int                        `json:"flowScore"`
	SentenceLengthDistribution SentenceLengthDistribution `json:"sentenceLengthDistribution"`
	FlowInsights               FlowInsights               `json:"flowInsights"`
	KeywordDensity             []KeywordDensity           `json:"keywordDensity"`
	Repetition                 RepetitionAnalysis         `json:"repetition"`
	Proximity                  ProximityAnalysis          `json:"proximity"`
	Cadence                    CadenceAnalysis            `json:"cadence"`
}

type tokenMatch struct {
	Text       string
	Normalized string
	Root       string
	From       int
	To         int
	Index      int
}

type sentenceMatch struct {
	Text           string
	From           int
	To             int
	ParagraphIndex int
}

var stopWords map[string]bool
var punctRegex *regexp.Regexp
var sentenceRegex *regexp.Regexp
var paragraphRegex *regexp.Regexp
var syllableClean1 *regexp.Regexp
var syllableClean2 *regexp.Regexp
var syllableMatches *regexp.Regexp
var tokenRegex *regexp.Regexp

func init() {
	words := []string{
		"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
		"of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
		"be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
		"should", "may", "might", "must", "shall", "can", "need", "dare", "ought",
		"used", "it", "its", "this", "that", "these", "those", "i", "you", "he",
		"she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
		"his", "our", "their", "mine", "yours", "hers", "ours", "theirs",
		"what", "which", "who", "whom", "whose", "where", "when", "why", "how",
		"all", "each", "every", "both", "few", "more", "most", "other", "some",
		"such", "no", "nor", "not", "only", "own", "same", "so", "than", "too",
		"very", "just", "also", "now", "here", "there", "then", "once", "if",
		"into", "through", "during", "before", "after", "above", "below", "up",
		"down", "out", "off", "over", "under", "again", "further", "any", "about",
	}
	stopWords = make(map[string]bool, len(words))
	for _, w := range words {
		stopWords[w] = true
	}

	punctRegex = regexp.MustCompile(`[^\w\s'-]`)
	sentenceRegex = regexp.MustCompile(`[.!?]+`)
	paragraphRegex = regexp.MustCompile(`\n\n+`)
	syllableClean1 = regexp.MustCompile(`(?:[^laeiouy]es|ed|[^laeiouy]e)$`)
	syllableClean2 = regexp.MustCompile(`^y`)
	syllableMatches = regexp.MustCompile(`[aeiouy]{1,2}`)
	tokenRegex = regexp.MustCompile(`[A-Za-z][A-Za-z'-]*`)
}

func AnalyzeText(text string) TextAnalytics {
	if text == "" {
		return GetEmptyAnalytics()
	}

	words := getWords(text)
	sentences := getSentences(text)
	paragraphs := getParagraphs(text)
	tokens := extractTokenMatches(text)

	wordCount := len(words)
	characterCount := len(text)
	characterCountNoSpaces := len(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, text))
	sentenceCount := len(sentences)
	paragraphCount := len(paragraphs)

	syllableCount := 0
	for _, word := range words {
		syllableCount += countSyllables(word)
	}

	readingLevel := calculateReadingLevel(wordCount, sentenceCount, syllableCount)

	readingTimeTotal := int(math.Ceil((float64(wordCount) / 225.0) * 60.0))
	readingTimeMinutes := readingTimeTotal / 60
	readingTimeSeconds := readingTimeTotal % 60

	speakingTimeTotal := int(math.Ceil((float64(wordCount) / 150.0) * 60.0))
	speakingTimeMinutes := speakingTimeTotal / 60
	speakingTimeSeconds := speakingTimeTotal % 60

	sentenceLengths := make([]int, len(sentences))
	for i, sentence := range sentences {
		sentenceLengths[i] = len(getWords(sentence))
	}

	averageSentenceLength := 0.0
	if sentenceCount > 0 {
		averageSentenceLength = math.Round((float64(wordCount)/float64(sentenceCount))*10) / 10
	}
	sentenceLengthVariation := calculateStandardDeviation(sentenceLengths)

	distribution := categorizeSentenceLengths(sentences)
	flowInsights := analyzeFlowInsights(distribution, sentences)

	flowScore := 0
	if sentenceCount > 0 {
		varScore := math.Min(100.0, (sentenceLengthVariation/8.0)*100.0)
		flowScore = int(math.Round((varScore * 0.6) + (float64(flowInsights.VarietyScore) * 0.4)))
	}

	return TextAnalytics{
		WordCount:                  wordCount,
		CharacterCount:             characterCount,
		CharacterCountNoSpaces:     characterCountNoSpaces,
		SentenceCount:              sentenceCount,
		ParagraphCount:             paragraphCount,
		ReadingLevel:               readingLevel,
		ReadingTimeMinutes:         readingTimeMinutes,
		ReadingTimeSeconds:         readingTimeSeconds,
		SpeakingTimeMinutes:        speakingTimeMinutes,
		SpeakingTimeSeconds:        speakingTimeSeconds,
		AverageSentenceLength:      averageSentenceLength,
		SentenceLengthVariation:    sentenceLengthVariation,
		FlowScore:                  flowScore,
		SentenceLengthDistribution: distribution,
		FlowInsights:               flowInsights,
		KeywordDensity:             calculateKeywordDensity(words, wordCount),
		Repetition:                 analyzeRepetition(text, tokens),
		Proximity:                  analyzeProximity(text, tokens),
		Cadence:                    analyzeCadence(text),
	}
}

func GetEmptyAnalytics() TextAnalytics {
	return TextAnalytics{
		WordCount:               0,
		CharacterCount:          0,
		CharacterCountNoSpaces:  0,
		SentenceCount:           0,
		ParagraphCount:          0,
		ReadingLevel:            "N/A",
		ReadingTimeMinutes:      0,
		ReadingTimeSeconds:      0,
		SpeakingTimeMinutes:     0,
		SpeakingTimeSeconds:     0,
		AverageSentenceLength:   0,
		SentenceLengthVariation: 0,
		FlowScore:               0,
		SentenceLengthDistribution: SentenceLengthDistribution{
			Count1: 0, Count2To6: 0, Count7To15: 0, Count16To25: 0, Count26To39: 0, Count40Plus: 0,
		},
		FlowInsights: FlowInsights{
			ConsecutivePatterns: 0,
			DominantRange:       "7-15",
			VarietyScore:        0,
			HasMonotony:         false,
		},
		KeywordDensity: []KeywordDensity{},
		Repetition: RepetitionAnalysis{
			Items:      []PhraseEchoItem{},
			TotalFlags: 0,
		},
		Proximity: ProximityAnalysis{
			Items:      []ProximityConflictItem{},
			TotalFlags: 0,
		},
		Cadence: CadenceAnalysis{
			Sentences: []CadenceSentence{},
			Hotspots:  []CadenceHotspot{},
		},
	}
}

func countSyllables(word string) int {
	word = strings.TrimSpace(strings.ToLower(word))
	if len(word) <= 3 {
		return 1
	}

	word = syllableClean1.ReplaceAllString(word, "")
	word = syllableClean2.ReplaceAllString(word, "")

	matches := syllableMatches.FindAllString(word, -1)
	if len(matches) > 0 {
		return len(matches)
	}
	return 1
}

func getWords(text string) []string {
	cleaned := punctRegex.ReplaceAllString(text, " ")
	return strings.Fields(cleaned)
}

func getSentences(text string) []string {
	parts := sentenceRegex.Split(text, -1)
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func getParagraphs(text string) []string {
	parts := paragraphRegex.Split(text, -1)
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func categorizeSentenceLengths(sentences []string) SentenceLengthDistribution {
	var dist SentenceLengthDistribution
	for _, sentence := range sentences {
		switch getSentenceBucket(len(getWords(sentence))) {
		case "1":
			dist.Count1++
		case "2-6":
			dist.Count2To6++
		case "7-15":
			dist.Count7To15++
		case "16-25":
			dist.Count16To25++
		case "26-39":
			dist.Count26To39++
		default:
			dist.Count40Plus++
		}
	}
	return dist
}

func getSentenceBucket(count int) string {
	if count <= 1 {
		return "1"
	}
	if count <= 6 {
		return "2-6"
	}
	if count <= 15 {
		return "7-15"
	}
	if count <= 25 {
		return "16-25"
	}
	if count <= 39 {
		return "26-39"
	}
	return "40+"
}

func detectConsecutivePatterns(sentences []string) int {
	lengths := make([]int, len(sentences))
	for i, sentence := range sentences {
		lengths[i] = len(getWords(sentence))
	}

	patternCount := 0
	consecutiveCount := 1
	for i := 1; i < len(lengths); i++ {
		if math.Abs(float64(lengths[i]-lengths[i-1])) <= 3 {
			consecutiveCount++
			if consecutiveCount >= 3 {
				patternCount++
			}
		} else {
			consecutiveCount = 1
		}
	}
	return patternCount
}

func calculateVarietyScore(dist SentenceLengthDistribution, totalSentences int) int {
	if totalSentences == 0 {
		return 0
	}

	values := []int{dist.Count1, dist.Count2To6, dist.Count7To15, dist.Count16To25, dist.Count26To39, dist.Count40Plus}
	probabilities := make([]float64, 0, len(values))
	for _, value := range values {
		if value > 0 {
			probabilities = append(probabilities, float64(value)/float64(totalSentences))
		}
	}

	if len(probabilities) <= 1 {
		return 0
	}

	entropy := 0.0
	for _, probability := range probabilities {
		entropy += probability * math.Log2(probability)
	}
	entropy = -entropy
	maxEntropy := math.Log2(float64(len(probabilities)))
	if maxEntropy == 0 {
		return 0
	}

	return int(math.Round((entropy / maxEntropy) * 100))
}

func analyzeFlowInsights(dist SentenceLengthDistribution, sentences []string) FlowInsights {
	totalSentences := dist.Count1 + dist.Count2To6 + dist.Count7To15 + dist.Count16To25 + dist.Count26To39 + dist.Count40Plus
	varietyScore := calculateVarietyScore(dist, totalSentences)
	consecutivePatterns := detectConsecutivePatterns(sentences)

	dominantRange := "7-15"
	dominantValue := -1
	for _, entry := range []struct {
		label string
		value int
	}{
		{"1", dist.Count1},
		{"2-6", dist.Count2To6},
		{"7-15", dist.Count7To15},
		{"16-25", dist.Count16To25},
		{"26-39", dist.Count26To39},
		{"40+", dist.Count40Plus},
	} {
		if entry.value > dominantValue {
			dominantRange = entry.label
			dominantValue = entry.value
		}
	}

	lengths := make([]int, len(sentences))
	for i, sentence := range sentences {
		lengths[i] = len(getWords(sentence))
	}

	maxConsecutive := 1
	currentConsecutive := 1
	for i := 1; i < len(lengths); i++ {
		if math.Abs(float64(lengths[i]-lengths[i-1])) <= 3 {
			currentConsecutive++
			if currentConsecutive > maxConsecutive {
				maxConsecutive = currentConsecutive
			}
		} else {
			currentConsecutive = 1
		}
	}

	return FlowInsights{
		ConsecutivePatterns: consecutivePatterns,
		DominantRange:       dominantRange,
		VarietyScore:        varietyScore,
		HasMonotony:         maxConsecutive >= 5,
	}
}

func calculateReadingLevel(wordCount, sentenceCount, syllableCount int) string {
	if wordCount == 0 || sentenceCount == 0 {
		return "N/A"
	}

	avgWordsPerSentence := float64(wordCount) / float64(sentenceCount)
	avgSyllablesPerWord := float64(syllableCount) / float64(wordCount)
	grade := 0.39*avgWordsPerSentence + 11.8*avgSyllablesPerWord - 15.59

	switch {
	case grade < 1:
		return "Kindergarten"
	case grade < 6:
		return "1st-5th Grade"
	case grade < 9:
		return "6th-8th Grade"
	case grade < 13:
		return "9th-12th Grade"
	case grade < 17:
		return "College Level"
	default:
		return "Graduate Level"
	}
}

func calculateStandardDeviation(numbers []int) float64 {
	if len(numbers) == 0 {
		return 0
	}

	sum := 0.0
	for _, number := range numbers {
		sum += float64(number)
	}
	mean := sum / float64(len(numbers))

	variance := 0.0
	for _, number := range numbers {
		diff := float64(number) - mean
		variance += diff * diff
	}
	variance /= float64(len(numbers))
	return math.Sqrt(variance)
}

func normalizeLexeme(word string) string {
	word = strings.ToLower(word)
	var builder strings.Builder
	for _, r := range word {
		if (r >= 'a' && r <= 'z') || r == '\'' || r == '-' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func stemWord(word string) string {
	stem := normalizeLexeme(word)
	if len(stem) <= 4 {
		return stem
	}

	suffixes := []string{"ingly", "edly", "ment", "ness", "tion", "sion", "able", "ible", "less", "ously", "ing", "ers", "ies", "ied", "est", "ism", "ist", "ous", "ive", "ful", "ly", "ed", "es", "er", "s"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(stem, suffix) && len(stem)-len(suffix) >= 3 {
			stem = stem[:len(stem)-len(suffix)]
			break
		}
	}

	if strings.HasSuffix(stem, "i") && len(stem) > 3 {
		stem = stem[:len(stem)-1] + "y"
	}

	if len(stem) >= 3 {
		last := stem[len(stem)-1]
		prev := stem[len(stem)-2]
		if last == prev && strings.ContainsRune("bcdfghjklmnpqrstvwxyz", rune(last)) {
			stem = stem[:len(stem)-1]
		}
	}

	return stem
}

func calculateKeywordDensity(words []string, totalWords int) []KeywordDensity {
	frequencies := map[string]int{}

	for _, word := range words {
		normalized := normalizeLexeme(word)
		if len(normalized) < 4 || stopWords[normalized] || strings.IndexFunc(normalized, unicode.IsDigit) >= 0 {
			continue
		}
		frequencies[normalized]++
	}

	type pair struct {
		word  string
		count int
	}

	pairs := make([]pair, 0, len(frequencies))
	for word, count := range frequencies {
		pairs = append(pairs, pair{word: word, count: count})
	}

	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].count == pairs[j].count {
			return pairs[i].word < pairs[j].word
		}
		return pairs[i].count > pairs[j].count
	})

	if len(pairs) > 100 {
		pairs = pairs[:100]
	}

	result := make([]KeywordDensity, 0, len(pairs))
	denominator := math.Max(float64(totalWords), 1)
	for _, item := range pairs {
		result = append(result, KeywordDensity{
			Word:       item.word,
			Count:      item.count,
			Percentage: math.Round((float64(item.count)/denominator)*1000) / 10,
		})
	}

	return result
}

func extractTokenMatches(text string) []tokenMatch {
	matches := tokenRegex.FindAllStringIndex(text, -1)
	result := make([]tokenMatch, 0, len(matches))
	for index, match := range matches {
		raw := text[match[0]:match[1]]
		result = append(result, tokenMatch{
			Text:       raw,
			Normalized: normalizeLexeme(raw),
			Root:       stemWord(raw),
			From:       match[0],
			To:         match[1],
			Index:      index,
		})
	}
	return result
}

func buildSnippet(text string, from, to, radius int) string {
	start := from - radius
	if start < 0 {
		start = 0
	}
	end := to + radius
	if end > len(text) {
		end = len(text)
	}
	prefix := ""
	suffix := ""
	if start > 0 {
		prefix = "..."
	}
	if end < len(text) {
		suffix = "..."
	}
	return prefix + strings.Join(strings.Fields(text[start:end]), " ") + suffix
}

func severityFromScore(score int) string {
	switch {
	case score >= 4:
		return "high"
	case score >= 2:
		return "medium"
	default:
		return "low"
	}
}

func analyzeRepetition(text string, tokens []tokenMatch) RepetitionAnalysis {
	type phraseGroup struct {
		phrase      string
		ranges      []AnalyticsHighlightRange
		tokenStarts []int
	}

	phraseMap := map[string]*phraseGroup{}

	for size := 2; size <= 5; size++ {
		for index := 0; index+size <= len(tokens); index++ {
			slice := tokens[index : index+size]
			contentCount := 0
			parts := make([]string, 0, len(slice))
			surface := make([]string, 0, len(slice))
			for _, token := range slice {
				parts = append(parts, token.Normalized)
				surface = append(surface, strings.ToLower(token.Text))
				if len(token.Normalized) >= 4 && !stopWords[token.Normalized] {
					contentCount++
				}
			}
			if contentCount < 2 {
				continue
			}

			key := strings.Join(parts, " ")
			group, ok := phraseMap[key]
			if !ok {
				group = &phraseGroup{
					phrase:      strings.Join(surface, " "),
					ranges:      []AnalyticsHighlightRange{},
					tokenStarts: []int{},
				}
				phraseMap[key] = group
			}

			overlaps := false
			for _, start := range group.tokenStarts {
				if absInt(start-index) < size {
					overlaps = true
					break
				}
			}
			if overlaps {
				continue
			}

			group.tokenStarts = append(group.tokenStarts, index)
			group.ranges = append(group.ranges, AnalyticsHighlightRange{
				From: slice[0].From,
				To:   slice[len(slice)-1].To,
				Text: text[slice[0].From:slice[len(slice)-1].To],
			})
		}
	}

	type scoredPhrase struct {
		key   string
		group *phraseGroup
	}
	scored := make([]scoredPhrase, 0, len(phraseMap))
	for key, group := range phraseMap {
		if len(group.ranges) >= 2 {
			scored = append(scored, scoredPhrase{key: key, group: group})
		}
	}

	sort.Slice(scored, func(i, j int) bool {
		if len(scored[i].group.ranges) == len(scored[j].group.ranges) {
			return len(scored[i].key) > len(scored[j].key)
		}
		return len(scored[i].group.ranges) > len(scored[j].group.ranges)
	})
	if len(scored) > 12 {
		scored = scored[:12]
	}

	items := make([]PhraseEchoItem, 0, len(scored))
	for _, entry := range scored {
		snippets := make([]string, 0, minInt(len(entry.group.ranges), 3))
		for i, highlight := range entry.group.ranges {
			if i >= 3 {
				break
			}
			snippets = append(snippets, buildSnippet(text, highlight.From, highlight.To, 28))
		}

		score := len(entry.group.ranges) + maxInt(0, len(strings.Split(entry.key, " "))-2)
		items = append(items, PhraseEchoItem{
			ID:              "echo:" + strings.ReplaceAll(entry.key, " ", "-"),
			Phrase:          entry.group.phrase,
			OccurrenceCount: len(entry.group.ranges),
			Severity:        severityFromScore(score),
			Snippets:        snippets,
			HighlightRanges: entry.group.ranges,
		})
	}

	return RepetitionAnalysis{
		Items:      items,
		TotalFlags: len(items),
	}
}

func analyzeProximity(text string, tokens []tokenMatch) ProximityAnalysis {
	byRoot := map[string][]tokenMatch{}
	for _, token := range tokens {
		if len(token.Normalized) < 4 || stopWords[token.Normalized] || len(token.Root) < 3 {
			continue
		}
		byRoot[token.Root] = append(byRoot[token.Root], token)
	}

	items := make([]ProximityConflictItem, 0)
	for root, group := range byRoot {
		if len(group) < 2 {
			continue
		}

		highlights := make([]AnalyticsHighlightRange, 0)
		minDistance := math.MaxInt
		var bestPair [2]tokenMatch
		found := false

		for index := 1; index < len(group); index++ {
			prev := group[index-1]
			current := group[index]
			distance := current.Index - prev.Index
			if distance > 26 {
				continue
			}

			if distance < minDistance {
				minDistance = distance
				bestPair = [2]tokenMatch{prev, current}
				found = true
			}

			for _, token := range []tokenMatch{prev, current} {
				exists := false
				for _, highlight := range highlights {
					if highlight.From == token.From && highlight.To == token.To {
						exists = true
						break
					}
				}
				if !exists {
					highlights = append(highlights, AnalyticsHighlightRange{
						From: token.From,
						To:   token.To,
						Text: text[token.From:token.To],
					})
				}
			}
		}

		if !found {
			continue
		}

		surfaceSet := map[string]struct{}{}
		surfaceForms := make([]string, 0, 4)
		for _, token := range group {
			form := strings.ToLower(token.Text)
			if _, ok := surfaceSet[form]; ok {
				continue
			}
			surfaceSet[form] = struct{}{}
			surfaceForms = append(surfaceForms, form)
			if len(surfaceForms) == 4 {
				break
			}
		}

		sort.Slice(highlights, func(i, j int) bool {
			return highlights[i].From < highlights[j].From
		})

		score := maxInt(1, 6-minInt(minDistance, 5)) + maxInt(0, len(highlights)-2)
		items = append(items, ProximityConflictItem{
			ID:              "prox:" + root,
			Root:            root,
			SurfaceForms:    surfaceForms,
			PartOfSpeech:    "root-family",
			MinWordDistance: minDistance,
			Severity:        severityFromScore(score),
			Snippets: []string{
				buildSnippet(text, bestPair[0].From, bestPair[0].To, 28),
				buildSnippet(text, bestPair[1].From, bestPair[1].To, 28),
			},
			HighlightRanges: highlights,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].MinWordDistance == items[j].MinWordDistance {
			return len(items[i].HighlightRanges) > len(items[j].HighlightRanges)
		}
		return items[i].MinWordDistance < items[j].MinWordDistance
	})
	if len(items) > 12 {
		items = items[:12]
	}

	return ProximityAnalysis{
		Items:      items,
		TotalFlags: len(items),
	}
}

func extractSentenceMatches(text string) []sentenceMatch {
	result := make([]sentenceMatch, 0)
	cursor := 0
	paragraphIndex := 0

	for cursor < len(text) {
		for cursor < len(text) && unicode.IsSpace(rune(text[cursor])) {
			if text[cursor] == '\n' && cursor+1 < len(text) && text[cursor+1] == '\n' {
				paragraphIndex++
			}
			cursor++
		}
		if cursor >= len(text) {
			break
		}

		start := cursor
		for cursor < len(text) && !strings.ContainsRune(".!?", rune(text[cursor])) {
			cursor++
		}
		for cursor < len(text) && strings.ContainsRune(".!?", rune(text[cursor])) {
			cursor++
		}

		raw := strings.TrimSpace(text[start:cursor])
		if raw == "" {
			continue
		}
		from := strings.Index(text[start:cursor], raw)
		if from < 0 {
			from = 0
		}
		absoluteFrom := start + from
		result = append(result, sentenceMatch{
			Text:           raw,
			From:           absoluteFrom,
			To:             absoluteFrom + len(raw),
			ParagraphIndex: paragraphIndex,
		})
	}

	return result
}

func analyzeCadence(text string) CadenceAnalysis {
	matches := extractSentenceMatches(text)
	sentences := make([]CadenceSentence, 0, len(matches))
	for index, sentence := range matches {
		wordCount := len(getWords(sentence.Text))
		sentences = append(sentences, CadenceSentence{
			ID:             fmt.Sprintf("sentence:%d", index),
			ParagraphIndex: sentence.ParagraphIndex,
			SentenceIndex:  index,
			From:           sentence.From,
			To:             sentence.To,
			WordCount:      wordCount,
			Bucket:         getSentenceBucket(wordCount),
			Snippet:        buildSnippet(text, sentence.From, sentence.To, 18),
		})
	}

	hotspots := make([]CadenceHotspot, 0)

	runStart := 0
	for runStart < len(sentences) {
		runEnd := runStart
		for runEnd+1 < len(sentences) && absInt(sentences[runEnd+1].WordCount-sentences[runEnd].WordCount) <= 3 {
			runEnd++
		}

		if runEnd-runStart+1 >= 5 {
			run := sentences[runStart : runEnd+1]
			highlights := make([]AnalyticsHighlightRange, 0, len(run))
			ids := make([]string, 0, len(run))
			for _, sentence := range run {
				ids = append(ids, sentence.ID)
				highlights = append(highlights, AnalyticsHighlightRange{
					From: sentence.From,
					To:   sentence.To,
					Text: text[sentence.From:sentence.To],
				})
			}

			hotspots = append(hotspots, CadenceHotspot{
				ID:              fmt.Sprintf("cadence:monotony:%d", runStart),
				Type:            "monotony",
				Label:           fmt.Sprintf("%d similar-length sentences", len(run)),
				Severity:        severityFromScore(len(run) - 1),
				Explanation:     "A long run of similarly sized sentences can flatten the rhythm.",
				SentenceIDs:     ids,
				HighlightRanges: highlights,
			})
		}

		runStart = runEnd + 1
	}

	for index := 1; index < len(sentences); index++ {
		prev := sentences[index-1]
		current := sentences[index]
		diff := absInt(current.WordCount - prev.WordCount)
		if diff < 12 {
			continue
		}

		severity := "medium"
		if diff >= 20 {
			severity = "high"
		}

		hotspots = append(hotspots, CadenceHotspot{
			ID:          fmt.Sprintf("cadence:whiplash:%d", index),
			Type:        "whiplash",
			Label:       fmt.Sprintf("%d -> %d words", prev.WordCount, current.WordCount),
			Severity:    severity,
			Explanation: "A sharp sentence-length jump creates a noticeable pacing snap.",
			SentenceIDs: []string{prev.ID, current.ID},
			HighlightRanges: []AnalyticsHighlightRange{
				{From: prev.From, To: prev.To, Text: text[prev.From:prev.To]},
				{From: current.From, To: current.To, Text: text[current.From:current.To]},
			},
		})
	}

	if len(hotspots) > 16 {
		hotspots = hotspots[:16]
	}

	return CadenceAnalysis{
		Sentences: sentences,
		Hotspots:  hotspots,
	}
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
