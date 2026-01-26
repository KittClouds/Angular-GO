// Package narrative provides verb→event classification using FST.
// This is the "Librarian" - mapping verb stems to EventClass/RelationType.
package narrative

// EventClass categorizes narrative events
type EventClass uint8

const (
	// Core narrative events
	EventMeet      EventClass = 0
	EventTravel    EventClass = 1
	EventDiscovery EventClass = 2
	EventTheft     EventClass = 3
	EventBattle    EventClass = 4
	EventNegotiate EventClass = 5
	EventBetrayal  EventClass = 6
	EventRescue    EventClass = 7
	EventRitual    EventClass = 8
	EventTrial     EventClass = 9
	EventDuel      EventClass = 10
	EventHeist     EventClass = 11
	EventCreate    EventClass = 12

	// State changes
	EventTransform EventClass = 20
	EventDeath     EventClass = 21
	EventBirth     EventClass = 22
	EventMarriage  EventClass = 23

	// Possession
	EventAcquire EventClass = 26
	EventLose    EventClass = 27

	// Causality
	EventCause   EventClass = 30
	EventPrevent EventClass = 31

	// Dialogue acts
	EventPromise    EventClass = 40
	EventThreat     EventClass = 41
	EventAccusation EventClass = 42
	EventBargain    EventClass = 43

	// Knowledge
	EventReveals  EventClass = 50
	EventConceals EventClass = 51
	EventDeceives EventClass = 52

	// Catch-all
	EventUnknown EventClass = 255
)

// Transitivity defines the argument structure of a verb
type Transitivity uint8

const (
	TransitiveNone Transitivity = 0
	Transitive     Transitivity = 1 // X verb Y
	Intransitive   Transitivity = 2 // X verb
	Ditransitive   Transitivity = 3 // X verb Y to Z
)

// String returns a readable name
func (e EventClass) String() string {
	switch e {
	case EventMeet:
		return "MEET"
	case EventTravel:
		return "TRAVEL"
	case EventDiscovery:
		return "DISCOVERY"
	case EventTheft:
		return "THEFT"
	case EventBattle:
		return "BATTLE"
	case EventNegotiate:
		return "NEGOTIATE"
	case EventBetrayal:
		return "BETRAYAL"
	case EventRescue:
		return "RESCUE"
	case EventRitual:
		return "RITUAL"
	case EventTrial:
		return "TRIAL"
	case EventDuel:
		return "DUEL"
	case EventHeist:
		return "HEIST"
	case EventTransform:
		return "TRANSFORM"
	case EventDeath:
		return "DEATH"
	case EventBirth:
		return "BIRTH"
	case EventMarriage:
		return "MARRIAGE"
	case EventAcquire:
		return "ACQUIRE"
	case EventLose:
		return "LOSE"
	case EventCause:
		return "CAUSE"
	case EventPrevent:
		return "PREVENT"
	case EventPromise:
		return "PROMISE"
	case EventThreat:
		return "THREAT"
	case EventAccusation:
		return "ACCUSATION"
	case EventBargain:
		return "BARGAIN"
	case EventReveals:
		return "REVEALS"
	case EventConceals:
		return "CONCEALS"
	case EventDeceives:
		return "DECEIVES"
	default:
		return "UNKNOWN"
	}
}

// RelationType is the graph edge label produced from a verb match
type RelationType uint8

const (
	RelInteracts RelationType = 0
	RelAttacks   RelationType = 1
	RelDefeats   RelationType = 2
	RelFights    RelationType = 3
	RelKills     RelationType = 4
	RelTravels   RelationType = 5
	RelArrives   RelationType = 6
	RelDeparts   RelationType = 7
	RelDiscovers RelationType = 8
	RelFinds     RelationType = 9
	RelSteals    RelationType = 10
	RelGives     RelationType = 11
	RelTakes     RelationType = 12
	RelOwns      RelationType = 13
	RelCreates   RelationType = 14
	RelDestroys  RelationType = 15
	RelSaves     RelationType = 16
	RelBetrays   RelationType = 17
	RelPromises  RelationType = 18
	RelThreatens RelationType = 19
	RelAccuses   RelationType = 20
	RelCauses    RelationType = 21
	RelEnables   RelationType = 22
	RelPrevents  RelationType = 23
	RelReveals   RelationType = 24
	RelConceals  RelationType = 25
	RelDeceives  RelationType = 26
	RelLoves     RelationType = 27
	RelHates     RelationType = 28
	RelServes    RelationType = 29
	RelRules     RelationType = 30
)

// String returns a readable name
func (r RelationType) String() string {
	switch r {
	case RelInteracts:
		return "INTERACTS"
	case RelAttacks:
		return "ATTACKS"
	case RelDefeats:
		return "DEFEATS"
	case RelFights:
		return "FIGHTS"
	case RelKills:
		return "KILLS"
	case RelTravels:
		return "TRAVELS"
	case RelArrives:
		return "ARRIVES"
	case RelDeparts:
		return "DEPARTS"
	case RelDiscovers:
		return "DISCOVERS"
	case RelFinds:
		return "FINDS"
	case RelSteals:
		return "STEALS"
	case RelGives:
		return "GIVES"
	case RelTakes:
		return "TAKES"
	case RelOwns:
		return "OWNS"
	case RelCreates:
		return "CREATES"
	case RelDestroys:
		return "DESTROYS"
	case RelSaves:
		return "SAVES"
	case RelBetrays:
		return "BETRAYS"
	case RelPromises:
		return "PROMISES"
	case RelThreatens:
		return "THREATENS"
	case RelAccuses:
		return "ACCUSES"
	case RelCauses:
		return "CAUSES"
	case RelEnables:
		return "ENABLES"
	case RelPrevents:
		return "PREVENTS"
	case RelReveals:
		return "REVEALS"
	case RelConceals:
		return "CONCEALS"
	case RelDeceives:
		return "DECEIVES"
	case RelLoves:
		return "LOVES"
	case RelHates:
		return "HATES"
	case RelServes:
		return "SERVES"
	case RelRules:
		return "RULES"
	default:
		return "UNKNOWN"
	}
}
