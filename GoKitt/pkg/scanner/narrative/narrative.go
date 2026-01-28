package narrative

import (
	"bytes"
	"sort"
	"strings"

	vellum "github.com/kittclouds/gokitt/pkg/fst"
)

// VerbMatch is the result of looking up a verb
type VerbMatch struct {
	EventClass   EventClass
	RelationType RelationType
	Transitivity Transitivity
}

// NarrativeMatcher uses FST to map verb stems to events
type NarrativeMatcher struct {
	fst     *vellum.FST
	overlay map[string]VerbMatch // Runtime additions
}

// verbEntry is a static verb→event mapping
type verbEntry struct {
	stem         string
	event        EventClass
	relation     RelationType
	transitivity Transitivity
}

// VERB_ENTRIES: sorted list of verb stems → (EventClass, RelationType, Transitivity)
// VERB_ENTRIES: sorted list of verb stems → (EventClass, RelationType, Transitivity)
// Note: Stems must be lowercase.
var verbEntries = []verbEntry{
	// Battle/Combat
	{"attack", EventBattle, RelAttacks, Transitive},
	{"battl", EventBattle, RelFights, Intransitive}, // battle with
	{"defeat", EventBattle, RelDefeats, Transitive},
	{"duel", EventDuel, RelFights, Intransitive},
	{"fight", EventBattle, RelFights, Transitive}, // fight X
	{"kill", EventDeath, RelKills, Transitive},
	{"slay", EventDeath, RelKills, Transitive},
	{"wound", EventBattle, RelAttacks, Transitive},

	// Travel/Movement
	{"approach", EventTravel, RelArrives, Intransitive},
	{"arriv", EventTravel, RelArrives, Intransitive},
	{"depart", EventTravel, RelDeparts, Intransitive},
	{"enter", EventTravel, RelArrives, Transitive},
	{"exit", EventTravel, RelDeparts, Transitive},
	{"journey", EventTravel, RelTravels, Intransitive},
	{"leav", EventTravel, RelDeparts, Transitive},
	{"sail", EventTravel, RelTravels, Intransitive},
	{"travel", EventTravel, RelTravels, Intransitive},
	{"visit", EventTravel, RelArrives, Transitive},

	// Discovery/Knowledge
	{"conceal", EventConceals, RelConceals, Transitive},
	{"discov", EventDiscovery, RelDiscovers, Transitive},
	{"find", EventDiscovery, RelFinds, Transitive},
	{"hid", EventConceals, RelConceals, Transitive}, // hide -> hid
	{"learn", EventDiscovery, RelDiscovers, Transitive},
	{"li", EventDeceives, RelDeceives, Intransitive}, // lie -> li
	{"reveal", EventReveals, RelReveals, Transitive},
	{"uncover", EventDiscovery, RelDiscovers, Transitive},

	// State Change/Copula
	{"are", EventState, RelIs, Transitive},
	{"be", EventState, RelIs, Transitive},
	{"becam", EventTransform, RelBecomes, Transitive}, // became -> becam? NO, stemming logic is weak. Let's add 'became'.
	{"became", EventTransform, RelBecomes, Transitive},
	{"become", EventTransform, RelBecomes, Transitive},
	{"been", EventState, RelIs, Transitive},
	{"is", EventState, RelIs, Transitive},
	{"transform", EventTransform, RelBecomes, Transitive},
	{"turn", EventTransform, RelBecomes, Intransitive}, // turn into
	{"was", EventState, RelIs, Transitive},
	{"were", EventState, RelIs, Transitive},

	// Perception/Observation (New)
	{"hear", EventDiscovery, RelObserves, Transitive},
	{"heard", EventDiscovery, RelObserves, Transitive}, // Irregular past
	{"look", EventDiscovery, RelObserves, Transitive},  // look at
	{"notic", EventDiscovery, RelObserves, Transitive},
	{"observ", EventDiscovery, RelObserves, Transitive},
	{"saw", EventDiscovery, RelObserves, Transitive}, // Irregular past of 'see'
	{"see", EventDiscovery, RelObserves, Transitive},
	{"watch", EventDiscovery, RelObserves, Transitive},
	{"witness", EventDiscovery, RelObserves, Transitive},

	// Possession
	{"give", EventAcquire, RelGives, Ditransitive},
	{"own", EventAcquire, RelOwns, Transitive},
	{"steal", EventTheft, RelSteals, Transitive},
	{"take", EventAcquire, RelTakes, Transitive},

	// Causality
	{"caus", EventCause, RelCauses, Transitive},
	{"enabl", EventCause, RelEnables, Transitive},
	{"prevent", EventPrevent, RelPrevents, Transitive},

	// Dialogue/Speech (New & Expanded)
	{"accus", EventAccusation, RelAccuses, Transitive},
	{"ask", EventDialogue, RelSpeaksTo, Transitive},
	{"bargain", EventBargain, RelInteracts, Intransitive},
	{"call", EventDialogue, RelSpeaksTo, Transitive},
	{"claim", EventDialogue, RelSpeaksTo, Transitive},
	{"command", EventDialogue, RelRules, Transitive},
	{"crie", EventDialogue, RelSpeaksTo, Intransitive}, // cry -> crie/cri? Porter: cry->cri
	{"declar", EventDialogue, RelSpeaksTo, Transitive},
	{"explain", EventDialogue, RelSpeaksTo, Ditransitive},
	{"mention", EventDialogue, RelMentions, Transitive},
	{"promis", EventPromise, RelPromises, Ditransitive},
	{"repli", EventDialogue, RelSpeaksTo, Intransitive}, // reply -> repli
	{"said", EventDialogue, RelSpeaksTo, Ditransitive},  // Irregular past of 'say'
	{"say", EventDialogue, RelSpeaksTo, Ditransitive},
	{"shout", EventDialogue, RelSpeaksTo, Transitive},
	{"speak", EventDialogue, RelSpeaksTo, Intransitive},
	{"spoke", EventDialogue, RelSpeaksTo, Intransitive}, // Irregular past of 'speak'
	{"state", EventDialogue, RelSpeaksTo, Transitive},
	{"suggest", EventDialogue, RelSpeaksTo, Transitive},
	{"tell", EventDialogue, RelSpeaksTo, Ditransitive},
	{"told", EventDialogue, RelSpeaksTo, Ditransitive}, // Irregular past of 'tell'
	{"threaten", EventThreat, RelThreatens, Transitive},
	{"whisper", EventDialogue, RelSpeaksTo, Transitive},
	{"yell", EventDialogue, RelSpeaksTo, Intransitive},

	// Social/Relationship
	{"alli", EventMeet, RelInteracts, Intransitive}, // ally
	{"betray", EventBetrayal, RelBetrays, Transitive},
	{"deceiv", EventDeceives, RelDeceives, Transitive},
	{"follow", EventMeet, RelServes, Transitive},
	{"friend", EventMeet, RelInteracts, Transitive}, // befriend
	{"help", EventRescue, RelSaves, Transitive},
	{"join", EventMeet, RelInteracts, Transitive},
	{"serv", EventMeet, RelServes, Transitive},
	{"support", EventMeet, RelAllies, Transitive}, // No RelSupport, use Allies/Serves

	// Emotions
	{"admir", EventMeet, RelLoves, Transitive},  // close enough
	{"fear", EventBattle, RelHates, Transitive}, // actually 'fears' isn't Hates, but indicates relation
	{"hat", EventBattle, RelHates, Transitive},
	{"lov", EventMeet, RelLoves, Transitive},
	{"trust", EventMeet, RelAllies, Transitive},

	// Rescue
	{"rescu", EventRescue, RelSaves, Transitive},
	{"sav", EventRescue, RelSaves, Transitive},

	// Meeting
	{"encount", EventMeet, RelInteracts, Transitive},
	{"meet", EventMeet, RelInteracts, Transitive},

	// Creation/Destruction
	{"build", EventCreate, RelCreates, Transitive},
	{"creat", EventCreate, RelCreates, Transitive},
	{"destroy", EventDeath, RelDestroys, Transitive},
	{"make", EventCreate, RelCreates, Transitive},

	// Authority
	{"rul", EventTrial, RelRules, Transitive},
}

// packValue encodes EventClass, RelationType, Transitivity into uint64
// Bits: [Transitivity 8][EventClass 8][RelationType 8]
func packValue(e EventClass, r RelationType, t Transitivity) uint64 {
	return (uint64(t) << 16) | (uint64(e) << 8) | uint64(r)
}

// unpackValue decodes EventClass, RelationType, Transitivity from uint64
func unpackValue(v uint64) (EventClass, RelationType, Transitivity) {
	return EventClass((v >> 8) & 0xFF), RelationType(v & 0xFF), Transitivity((v >> 16) & 0xFF)
}

// New creates a NarrativeMatcher with the embedded verb dictionary
func New() (*NarrativeMatcher, error) {
	// Sort entries for FST (must be lexicographic)
	sorted := make([]verbEntry, len(verbEntries))
	copy(sorted, verbEntries)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].stem < sorted[j].stem
	})

	// Build FST
	var buf bytes.Buffer
	builder, err := vellum.New(&buf, nil)
	if err != nil {
		return nil, err
	}

	for _, entry := range sorted {
		val := packValue(entry.event, entry.relation, entry.transitivity)
		err = builder.Insert([]byte(entry.stem), val)
		if err != nil {
			return nil, err
		}
	}

	err = builder.Close()
	if err != nil {
		return nil, err
	}

	// Load FST
	fst, err := vellum.Load(buf.Bytes())
	if err != nil {
		return nil, err
	}

	return &NarrativeMatcher{
		fst:     fst,
		overlay: make(map[string]VerbMatch),
	}, nil
}

// Common suffixes for simplistic stemming
var suffixes = []string{"ing", "ed", "es", "s", "er", "tion", "ness"}

// Stem applies simple Porter-like stemming to a verb
func (m *NarrativeMatcher) Stem(word string) string {
	// Optimization: 90% of calls are already lower from Chunker?
	// Chunker keeps original case in Token.Text, so likely Mixed case.
	// But `Lookup` calls `Stem`.

	// Fast path: check if lower
	isLower := true
	for i := 0; i < len(word); i++ {
		c := word[i]
		if c >= 'A' && c <= 'Z' {
			isLower = false
			break
		}
	}

	lower := word
	if !isLower {
		lower = strings.ToLower(word)
	}

	// Remove common suffixes
	for _, suffix := range suffixes {
		if strings.HasSuffix(lower, suffix) && len(lower) > len(suffix)+2 {
			return lower[:len(lower)-len(suffix)]
		}
	}

	return lower
}

// Lookup finds the event/relation for a verb
func (m *NarrativeMatcher) Lookup(verb string) *VerbMatch {
	stem := m.Stem(verb)

	// Check overlay first (runtime additions)
	if match, ok := m.overlay[stem]; ok {
		return &match
	}

	// Check FST
	val, found, err := m.fst.Get([]byte(stem))
	if err != nil || !found {
		return nil
	}

	event, relation, transitivity := unpackValue(val)
	return &VerbMatch{
		EventClass:   event,
		RelationType: relation,
		Transitivity: transitivity,
	}
}

// AddVerb adds a verb mapping at runtime
func (m *NarrativeMatcher) AddVerb(verb string, event EventClass, relation RelationType, transitivity Transitivity) {
	stem := m.Stem(verb)
	m.overlay[stem] = VerbMatch{
		EventClass:   event,
		RelationType: relation,
		Transitivity: transitivity,
	}
}

// OverlaySize returns the number of runtime additions
func (m *NarrativeMatcher) OverlaySize() int {
	return len(m.overlay)
}

// DictionarySize returns the number of entries in the FST
func (m *NarrativeMatcher) DictionarySize() int {
	return m.fst.Len()
}

// Close releases resources
func (m *NarrativeMatcher) Close() error {
	return m.fst.Close()
}
