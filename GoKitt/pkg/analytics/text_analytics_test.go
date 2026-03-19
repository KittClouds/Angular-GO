package analytics

import "testing"

func TestAnalyzeTextIncludesRepetitionProximityAndCadence(t *testing.T) {
	text := "The iron gate slammed shut. The iron gate rattled again. The iron gate shook against the wall. " +
		"Bright embers glowed beside the ember-lit grate. Bright embers hissed in the ash. " +
		"Short beat. Tiny pause. Quick breath. Small shrug. Brief glance. " +
		"This sentence suddenly stretches outward with a much more elaborate rhythm than the clipped run that came before it."

	result := AnalyzeText(text)

	if len(result.Repetition.Items) == 0 {
		t.Fatalf("expected repetition items, got none")
	}
	if result.Repetition.Items[0].OccurrenceCount < 2 {
		t.Fatalf("expected repeated phrase occurrence count >= 2, got %d", result.Repetition.Items[0].OccurrenceCount)
	}

	if len(result.Proximity.Items) == 0 {
		t.Fatalf("expected proximity items, got none")
	}
	if result.Proximity.Items[0].MinWordDistance <= 0 {
		t.Fatalf("expected positive proximity distance, got %d", result.Proximity.Items[0].MinWordDistance)
	}

	if len(result.Cadence.Sentences) == 0 {
		t.Fatalf("expected cadence sentences, got none")
	}
	if len(result.Cadence.Hotspots) == 0 {
		t.Fatalf("expected cadence hotspots, got none")
	}
}

func TestGetEmptyAnalyticsHasStableCollections(t *testing.T) {
	result := GetEmptyAnalytics()

	if result.Repetition.Items == nil || len(result.Repetition.Items) != 0 {
		t.Fatalf("expected empty repetition slice, got %#v", result.Repetition.Items)
	}
	if result.Proximity.Items == nil || len(result.Proximity.Items) != 0 {
		t.Fatalf("expected empty proximity slice, got %#v", result.Proximity.Items)
	}
	if result.Cadence.Sentences == nil || len(result.Cadence.Sentences) != 0 {
		t.Fatalf("expected empty cadence sentences, got %#v", result.Cadence.Sentences)
	}
	if result.Cadence.Hotspots == nil || len(result.Cadence.Hotspots) != 0 {
		t.Fatalf("expected empty cadence hotspots, got %#v", result.Cadence.Hotspots)
	}
}
