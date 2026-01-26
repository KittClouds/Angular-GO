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
	{"arriv", EventTravel, RelArrives, Intransitive}, // arrive at
	{"depart", EventTravel, RelDeparts, Intransitive},
	{"journey", EventTravel, RelTravels, Intransitive},
	{"leav", EventTravel, RelDeparts, Transitive}, // leave X
	{"travel", EventTravel, RelTravels, Intransitive},
	{"visit", EventTravel, RelArrives, Transitive},

	// Discovery
	{"discov", EventDiscovery, RelDiscovers, Transitive},
	{"find", EventDiscovery, RelFinds, Transitive},
	{"learn", EventDiscovery, RelDiscovers, Transitive},
	{"reveal", EventReveals, RelReveals, Transitive},
	{"uncover", EventDiscovery, RelDiscovers, Transitive},

	// Possession
	{"give", EventAcquire, RelGives, Ditransitive},
	{"own", EventAcquire, RelOwns, Transitive},
	{"steal", EventTheft, RelSteals, Transitive},
	{"take", EventAcquire, RelTakes, Transitive},

	// Causality
	{"caus", EventCause, RelCauses, Transitive},
	{"enabl", EventCause, RelEnables, Transitive},
	{"prevent", EventPrevent, RelPrevents, Transitive},

	// Dialogue
	{"accus", EventAccusation, RelAccuses, Transitive},
	{"bargain", EventBargain, RelInteracts, Intransitive},
	{"promis", EventPromise, RelPromises, Ditransitive},
	{"threaten", EventThreat, RelThreatens, Transitive},

	// Betrayal/Trust
	{"betray", EventBetrayal, RelBetrays, Transitive},
	{"deceiv", EventDeceives, RelDeceives, Transitive},

	// Rescue
	{"rescu", EventRescue, RelSaves, Transitive},
	{"sav", EventRescue, RelSaves, Transitive},

	// Meeting
	{"encount", EventMeet, RelInteracts, Transitive},
	{"meet", EventMeet, RelInteracts, Transitive},

	// Emotions/Relations
	{"hat", EventBattle, RelHates, Transitive},
	{"lov", EventMeet, RelLoves, Transitive},

	// Creation/Destruction
	{"creat", EventDiscovery, RelCreates, Transitive},
	{"destroy", EventDeath, RelDestroys, Transitive},

	// Authority
	{"rul", EventTrial, RelRules, Transitive},
	{"serv", EventMeet, RelServes, Transitive},
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

// Stem applies simple Porter-like stemming to a verb
func (m *NarrativeMatcher) Stem(word string) string {
	lower := strings.ToLower(word)

	// Remove common suffixes
	suffixes := []string{"ing", "ed", "es", "s", "er", "tion", "ness"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(lower, suffix) && len(lower) > len(suffix)+2 {
			return strings.TrimSuffix(lower, suffix)
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
