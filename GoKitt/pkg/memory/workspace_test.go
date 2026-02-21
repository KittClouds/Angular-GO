package memory

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// =============================================================================
// MissScore tests
// =============================================================================

func TestWorkspace_MissScore_AllMiss(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	// Prompt terms have zero overlap with observations
	score := ws.MissScore("fiora blade champion lore", "The weather today is sunny")
	assert.Less(t, score, ws.cfg.MissScoreThreshold, "all-miss prompt should score below threshold")
}

func TestWorkspace_MissScore_AllHit(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	obs := "Fiora is a blade champion known for her lore and dueling skills"
	score := ws.MissScore("fiora blade champion lore", obs)
	assert.GreaterOrEqual(t, score, ws.cfg.MissScoreThreshold, "all-hit prompt should score at or above threshold")
}

func TestWorkspace_MissScore_EmptyObservations(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	score := ws.MissScore("anything here", "")
	assert.Equal(t, 0.0, score, "empty observations should give zero score")
}

func TestWorkspace_MissScore_EmptyPrompt(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	score := ws.MissScore("", "lots of observations here")
	assert.Equal(t, 0.0, score, "empty prompt should give zero score")
}

func TestWorkspace_ShouldActivate_Miss(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	activate, reason := ws.ShouldActivate("dragon lore champion skill", "The cat sat on the mat")
	assert.True(t, activate, "should activate on miss")
	assert.NotEmpty(t, reason)
}

func TestWorkspace_ShouldActivate_Hit(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}

	obs := "Dragon lore covers the champion's skill and ability progression"
	activate, _ := ws.ShouldActivate("dragon lore champion skill", obs)
	assert.False(t, activate, "should not activate when observations cover the prompt")
}

// =============================================================================
// tokenize helper
// =============================================================================

func TestTokenize(t *testing.T) {
	tokens := tokenize("Hello, world! This is a test.")
	// "is" and "a" are 2 chars or less → filtered
	assert.Contains(t, tokens, "hello")
	assert.Contains(t, tokens, "world")
	assert.Contains(t, tokens, "this")
	assert.Contains(t, tokens, "test")
	assert.NotContains(t, tokens, "is") // 2 chars
	assert.NotContains(t, tokens, "a")  // 1 char
}

// =============================================================================
// intArg helper
// =============================================================================

func TestIntArg_Default(t *testing.T) {
	args := ToolArgs{}
	assert.Equal(t, 42, intArg(args, "missing", 42))
}

func TestIntArg_IntValue(t *testing.T) {
	args := ToolArgs{"k": 7}
	assert.Equal(t, 7, intArg(args, "k", 99))
}

func TestIntArg_Float64Value(t *testing.T) {
	args := ToolArgs{"k": float64(5)}
	assert.Equal(t, 5, intArg(args, "k", 99))
}

// =============================================================================
// Tool error paths (no store wired — exercises error guards)
// =============================================================================

func TestWorkspace_RunTool_UnknownTool(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}
	result := ws.RunTool("no_such_tool", ToolArgs{})
	assert.False(t, result.Ok)
	assert.Contains(t, result.Error, "unknown tool")
}

func TestWorkspace_RunTool_SearchBlocksGDR_NilIndex(t *testing.T) {
	ws := &Workspace{gdrIdx: nil, cfg: DefaultWorkspaceConfig()}
	result := ws.RunTool(ToolSearchBlocksGDR, ToolArgs{"query": "test"})
	// Nil GDR is not an error — returns empty results gracefully
	assert.True(t, result.Ok)
}

func TestWorkspace_BuildObservation_Format(t *testing.T) {
	ws := &Workspace{cfg: DefaultWorkspaceConfig()}
	obs := ws.buildObservation("thread-1", "dragon lore", "some summary")
	assert.Contains(t, obs, "Workspace resurfaced")
	assert.Contains(t, obs, "dragon lore")
	assert.Contains(t, obs, "some summary")
}
