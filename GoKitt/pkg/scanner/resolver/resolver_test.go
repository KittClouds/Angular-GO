package resolver

import "testing"

func setupResolver() *Resolver {
	r := New()
	r.Context.Register(EntityMetadata{
		ID:      "e1",
		Name:    "Gandalf",
		Gender:  GenderMale,
		Aliases: []string{"Mithrandir", "The Wizard"},
	})
	r.Context.Register(EntityMetadata{
		ID:      "e2",
		Name:    "Galadriel",
		Gender:  GenderFemale,
		Aliases: []string{"Lady of Light"},
	})
	r.Context.Register(EntityMetadata{
		ID:      "e3",
		Name:    "The Ring",
		Gender:  GenderNeutral,
		Aliases: []string{"My Precious"},
	})
	return r
}

func TestPronounSimple(t *testing.T) {
	r := setupResolver()

	// "Gandalf walked."
	r.ObserveMention("e1")

	// "He stopped."
	res := r.Resolve("He")
	if res != "e1" {
		t.Errorf("Expected e1, got %s", res)
	}
}

func TestGenderSwitch(t *testing.T) {
	r := setupResolver()

	r.ObserveMention("e1") // Gandalf
	r.ObserveMention("e2") // Galadriel (most recent)

	// "She" -> Galadriel
	if res := r.Resolve("She"); res != "e2" {
		t.Errorf("Expected e2 for She, got %s", res)
	}

	// "He" -> Gandalf (skips Galadriel)
	if res := r.Resolve("He"); res != "e1" {
		t.Errorf("Expected e1 for He, got %s", res)
	}
}

func TestAliasResolution(t *testing.T) {
	r := setupResolver()

	if res := r.Resolve("Gandalf"); res != "e1" {
		t.Errorf("Expected e1 for Gandalf")
	}

	if res := r.Resolve("Mithrandir"); res != "e1" {
		t.Errorf("Expected e1 for Mithrandir")
	}

	if res := r.Resolve("Lady of Light"); res != "e2" {
		t.Errorf("Expected e2 for Lady of Light")
	}
}

func TestRecencyUpdate(t *testing.T) {
	r := setupResolver()

	r.ObserveMention("e1") // Gandalf
	r.ObserveMention("e1") // Gandalf again

	// Register Frodo
	r.Context.Register(EntityMetadata{ID: "e4", Name: "Frodo", Gender: GenderMale})
	r.ObserveMention("e4") // Frodo

	// "He" -> Frodo
	if res := r.Resolve("He"); res != "e4" {
		t.Errorf("Expected e4 (Frodo), got %s", res)
	}
}
