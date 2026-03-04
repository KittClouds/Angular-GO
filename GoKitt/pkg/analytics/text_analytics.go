package analytics

import (
	"math"
	"regexp"
	"sort"
	"strings"
)

// SentenceLengthDistribution matches the TS interface
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
}

var stopWords map[string]bool
var punctRegex *regexp.Regexp
var sentenceRegex *regexp.Regexp
var paragraphRegex *regexp.Regexp
var syllableClean1 *regexp.Regexp
var syllableClean2 *regexp.Regexp
var syllableMatches *regexp.Regexp
var keywordClean *regexp.Regexp

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

	keywordClean = regexp.MustCompile(`[^a-z'-]`)
}

func AnalyzeText(text string) TextAnalytics {
	if text == "" {
		return GetEmptyAnalytics()
	}

	words := getWords(text)
	sentences := getSentences(text)
	paragraphs := getParagraphs(text)

	wordCount := len(words)
	characterCount := len(text)
	characterCountNoSpaces := len(strings.ReplaceAll(text, " ", ""))
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
	for i, s := range sentences {
		sentenceLengths[i] = len(getWords(s))
	}

	averageSentenceLength := 0.0
	if sentenceCount > 0 {
		averageSentenceLength = math.Round((float64(wordCount)/float64(sentenceCount))*10) / 10
	}
	sentenceLengthVariation := calculateStandardDeviation(sentenceLengths)

	distribution := categorizeSentenceLengths(sentenceLengths)
	flowInsights := analyzeFlowInsights(distribution, sentenceLengths)

	flowScore := 0
	if sentenceCount > 0 {
		varScore := math.Min(100.0, (sentenceLengthVariation/8.0)*100.0)
		flowScore = int(math.Round((varScore * 0.6) + (float64(flowInsights.VarietyScore) * 0.4)))
	}

	keywordDensity := calculateKeywordDensity(words, wordCount)

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
		KeywordDensity:             keywordDensity,
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
	parts := strings.Fields(cleaned)
	return parts
}

func getSentences(text string) []string {
	parts := sentenceRegex.Split(text, -1)
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if len(trimmed) > 0 {
			result = append(result, trimmed)
		}
	}
	return result
}

func getParagraphs(text string) []string {
	parts := paragraphRegex.Split(text, -1)
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if len(trimmed) > 0 {
			result = append(result, trimmed)
		}
	}
	return result
}

func categorizeSentenceLengths(lengths []int) SentenceLengthDistribution {
	var dist SentenceLengthDistribution
	for _, count := range lengths {
		if count == 1 {
			dist.Count1++
		} else if count <= 6 {
			dist.Count2To6++
		} else if count <= 15 {
			dist.Count7To15++
		} else if count <= 25 {
			dist.Count16To25++
		} else if count <= 39 {
			dist.Count26To39++
		} else {
			dist.Count40Plus++
		}
	}
	return dist
}

func analyzeFlowInsights(dist SentenceLengthDistribution, lengths []int) FlowInsights {
	consecutivePatterns := 0
	consecutiveCount := 1
	for i := 1; i < len(lengths); i++ {
		diff := float64(lengths[i] - lengths[i-1])
		if math.Abs(diff) <= 3 {
			consecutiveCount++
			if consecutiveCount >= 3 {
				consecutivePatterns++
			}
		} else {
			consecutiveCount = 1
		}
	}

	totalSentences := dist.Count1 + dist.Count2To6 + dist.Count7To15 + dist.Count16To25 + dist.Count26To39 + dist.Count40Plus
	varietyScore := 0
	if totalSentences > 0 {
		probs := make([]float64, 0)
		for _, v := range []int{dist.Count1, dist.Count2To6, dist.Count7To15, dist.Count16To25, dist.Count26To39, dist.Count40Plus} {
			if v > 0 {
				probs = append(probs, float64(v)/float64(totalSentences))
			}
		}
		if len(probs) > 1 {
			entropy := 0.0
			for _, p := range probs {
				entropy += p * math.Log2(p)
			}
			entropy = -entropy
			maxEntropy := math.Log2(float64(len(probs)))
			if maxEntropy > 0 {
				varietyScore = int(math.Round((entropy / maxEntropy) * 100))
			}
		}
	}

	dominantRange := "7-15"
	maxVal := -1
	ranges := map[string]int{
		"1":     dist.Count1,
		"2-6":   dist.Count2To6,
		"7-15":  dist.Count7To15,
		"16-25": dist.Count16To25,
		"26-39": dist.Count26To39,
		"40+":   dist.Count40Plus,
	}

	// Create an ordered list to replicate the JS Object.entries iteration (first to max wins)
	orderedKeys := []string{"1", "2-6", "7-15", "16-25", "26-39", "40+"}
	for _, k := range orderedKeys {
		if ranges[k] > maxVal {
			maxVal = ranges[k]
			dominantRange = k
		}
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

	if grade < 1 {
		return "Kindergarten"
	} else if grade < 6 {
		return "1st-5th Grade"
	} else if grade < 9 {
		return "6th-8th Grade"
	} else if grade < 13 {
		return "9th-12th Grade"
	} else if grade < 17 {
		return "College Level"
	}
	return "Graduate Level"
}

func calculateStandardDeviation(numbers []int) float64 {
	if len(numbers) == 0 {
		return 0
	}
	sum := 0.0
	for _, n := range numbers {
		sum += float64(n)
	}
	mean := sum / float64(len(numbers))
	sqDiffs := 0.0
	for _, n := range numbers {
		diff := float64(n) - mean
		sqDiffs += diff * diff
	}
	return math.Sqrt(sqDiffs / float64(len(numbers)))
}

type kw struct {
	w string
	c int
}

func calculateKeywordDensity(words []string, totalWords int) []KeywordDensity {
	freq := make(map[string]int)

	hasDigit := regexp.MustCompile(`\d`)

	for _, w := range words {
		norm := strings.ToLower(w)
		norm = keywordClean.ReplaceAllString(norm, "")

		if len(norm) < 4 || stopWords[norm] || hasDigit.MatchString(norm) {
			continue
		}
		freq[norm]++
	}

	var list []kw
	for k, v := range freq {
		list = append(list, kw{k, v})
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].c > list[j].c
	})

	max := 100
	if len(list) < max {
		max = len(list)
	}
	list = list[:max]

	res := make([]KeywordDensity, len(list))
	for i, item := range list {
		res[i] = KeywordDensity{
			Word:       item.w,
			Count:      item.c,
			Percentage: math.Round((float64(item.c)/float64(totalWords))*1000) / 10,
		}
	}
	return res
}

func GetEmptyAnalytics() TextAnalytics {
	return TextAnalytics{
		WordCount:                  0,
		CharacterCount:             0,
		CharacterCountNoSpaces:     0,
		SentenceCount:              0,
		ParagraphCount:             0,
		ReadingLevel:               "N/A",
		ReadingTimeMinutes:         0,
		ReadingTimeSeconds:         0,
		SpeakingTimeMinutes:        0,
		SpeakingTimeSeconds:        0,
		AverageSentenceLength:      0,
		SentenceLengthVariation:    0,
		FlowScore:                  0,
		SentenceLengthDistribution: SentenceLengthDistribution{},
		FlowInsights: FlowInsights{
			ConsecutivePatterns: 0,
			DominantRange:       "7-15",
			VarietyScore:        0,
			HasMonotony:         false,
		},
		KeywordDensity: []KeywordDensity{},
	}
}
