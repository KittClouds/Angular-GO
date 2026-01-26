package discovery

import (
	"github.com/kittclouds/gokitt/pkg/dafsa"
	"github.com/kittclouds/gokitt/pkg/scanner/narrative"
)

// RelationalScanner infers entity types from narrative events
type RelationalScanner struct {
	// Could add learning stats here later
}

func NewRelationalScanner() *RelationalScanner {
	return &RelationalScanner{}
}

// InferTarget guesses the likely Kind of the object based on subject + event
func (s *RelationalScanner) InferTarget(sourceKind dafsa.EntityKind, event narrative.EventClass) dafsa.EntityKind {
	// Fallback logic based on static heuristics

	// 1. CHARACTER Context
	if sourceKind == dafsa.KindCharacter {
		switch event {
		case narrative.EventBattle, narrative.EventDuel, narrative.EventDeath:
			// Characters usually fight other characters (or monsters, which we flag as Character/Other)
			return dafsa.KindCharacter

		case narrative.EventMeet, narrative.EventNegotiate, narrative.EventBetrayal,
			narrative.EventRescue, narrative.EventMarriage, narrative.EventPromise,
			narrative.EventThreat, narrative.EventAccusation:
			// Social interactions imply another agent
			return dafsa.KindCharacter

		case narrative.EventTravel:
			// Movement implies Location
			return dafsa.KindPlace

		case narrative.EventAcquire, narrative.EventLose, narrative.EventTheft:
			// Possessing something implies Item
			return dafsa.KindItem

		case narrative.EventCreate:
			// Creating usually implies Item or Concept
			return dafsa.KindItem
		}
	}

	// 2. FACTION Context
	if sourceKind == dafsa.KindFaction || sourceKind == dafsa.KindOrganization {
		switch event {
		case narrative.EventBattle:
			return dafsa.KindFaction
		case narrative.EventNegotiate:
			return dafsa.KindFaction
		}
	}

	// Default to Unknown (we use KindOther as fallback or 0 depending on DAFSA)
	// Returning KindOther (7) seems safest if no strong signal
	// But actually, we might return a specific "Unknown" if we had one.
	// For now, return KindOther.
	return dafsa.KindOther
}
