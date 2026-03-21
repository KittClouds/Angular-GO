package store

// ChatRunStatus is the lifecycle state of a run-based chat orchestration.
type ChatRunStatus string

const (
	ChatRunQueued           ChatRunStatus = "queued"
	ChatRunGathering        ChatRunStatus = "gathering"
	ChatRunPlanning         ChatRunStatus = "planning"
	ChatRunExecutingTools   ChatRunStatus = "executing_tools"
	ChatRunAwaitingTool     ChatRunStatus = "awaiting_tool_host"
	ChatRunAwaitingApproval ChatRunStatus = "awaiting_approval"
	ChatRunReadyToAnswer    ChatRunStatus = "ready_to_answer"
	ChatRunStreaming        ChatRunStatus = "streaming"
	ChatRunCompleted        ChatRunStatus = "completed"
	ChatRunDegraded         ChatRunStatus = "degraded"
	ChatRunFailed           ChatRunStatus = "failed"
	ChatRunCancelled        ChatRunStatus = "cancelled"
)

// ChatToolHost identifies where a tool is executed.
type ChatToolHost string

const (
	ChatToolHostGo         ChatToolHost = "go"
	ChatToolHostTypeScript ChatToolHost = "typescript"
)

// ChatToolClass identifies the risk/policy class of a tool.
type ChatToolClass string

const (
	ChatToolClassRead     ChatToolClass = "read"
	ChatToolClassProposal ChatToolClass = "proposal"
	ChatToolClassWrite    ChatToolClass = "write"
)

// ChatMutationPolicy controls how mutation-class tools behave.
type ChatMutationPolicy string

const (
	ChatMutationConfirm    ChatMutationPolicy = "confirm"
	ChatMutationTrusted    ChatMutationPolicy = "trusted_auto_edit"
	ChatMutationAutonomous ChatMutationPolicy = "full_autonomy"
)

// RunOptions configures a single chat orchestration run.
type RunOptions struct {
	FinalProvider          string             `json:"finalProvider"`
	FinalModel             string             `json:"finalModel"`
	PlannerModel           string             `json:"plannerModel,omitempty"`
	OMModel                string             `json:"omModel,omitempty"`
	PlannerEnabled         bool               `json:"plannerEnabled"`
	OMEnabled              bool               `json:"omEnabled"`
	WorkspaceEnabled       bool               `json:"workspaceEnabled"`
	MutationsEnabled       bool               `json:"mutationsEnabled"`
	DeadlineMs             int                `json:"deadlineMs"`
	MutationPolicy         ChatMutationPolicy `json:"mutationPolicy"`
	NarrativeID            string             `json:"narrativeId,omitempty"`
	FolderID               string             `json:"folderId,omitempty"`
	ScopeID                string             `json:"scopeId,omitempty"`
	BaseSystemPrompt       string             `json:"baseSystemPrompt,omitempty"`
	InitialExternalContext string             `json:"initialExternalContext,omitempty"`
}

// CapabilityProfile records which major subsystems were available to a run.
type CapabilityProfile struct {
	OMEnabled        bool `json:"omEnabled"`
	WorkspaceEnabled bool `json:"workspaceEnabled"`
	PlannerEnabled   bool `json:"plannerEnabled"`
	GoToolHost       bool `json:"goToolHost"`
	TSToolHost       bool `json:"tsToolHost"`
	BlockSearch      bool `json:"blockSearch"`
}

// EvidenceItem is a normalized piece of context gathered for the final answer.
type EvidenceItem struct {
	ID       string                 `json:"id"`
	Source   string                 `json:"source"`
	Title    string                 `json:"title,omitempty"`
	Content  string                 `json:"content"`
	Score    float64                `json:"score,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// ChatRun is the persisted control-plane record for one chat answer.
type ChatRun struct {
	ID                   string            `json:"id"`
	ThreadID             string            `json:"threadId"`
	UserPrompt           string            `json:"userPrompt"`
	Status               ChatRunStatus     `json:"status"`
	Options              RunOptions        `json:"options"`
	Capabilities         CapabilityProfile `json:"capabilities"`
	PreparedContext      string            `json:"preparedContext"`
	PreparedSystemPrompt string            `json:"preparedSystemPrompt"`
	PlannerMessagesJSON  string            `json:"plannerMessagesJson"`
	EvidenceJSON         string            `json:"evidenceJson"`
	MissingCapabilities  string            `json:"missingCapabilitiesJson"`
	Error                string            `json:"error,omitempty"`
	FinalResponse        string            `json:"finalResponse,omitempty"`
	AssistantMessageID   string            `json:"assistantMessageId,omitempty"`
	DeadlineAt           int64             `json:"deadlineAt"`
	CompletedAt          int64             `json:"completedAt,omitempty"`
	CreatedAt            int64             `json:"createdAt"`
	UpdatedAt            int64             `json:"updatedAt"`
}

// ChatRunEvent is an audit trail event emitted during a run.
type ChatRunEvent struct {
	ID        string `json:"id"`
	RunID     string `json:"runId"`
	Phase     string `json:"phase"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Detail    string `json:"detail,omitempty"`
	Status    string `json:"status,omitempty"`
	Payload   string `json:"payload,omitempty"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

// ChatToolCall stores a normalized tool invocation during a run.
type ChatToolCall struct {
	ID             string        `json:"id"`
	RunID          string        `json:"runId"`
	ToolCallID     string        `json:"toolCallId"`
	ToolName       string        `json:"toolName"`
	Host           ChatToolHost  `json:"host"`
	Class          ChatToolClass `json:"class"`
	Status         string        `json:"status"`
	ArgumentsJSON  string        `json:"argumentsJson"`
	ResultJSON     string        `json:"resultJson,omitempty"`
	Error          string        `json:"error,omitempty"`
	IdempotencyKey string        `json:"idempotencyKey,omitempty"`
	ApprovalID     string        `json:"approvalId,omitempty"`
	StartedAt      int64         `json:"startedAt,omitempty"`
	CompletedAt    int64         `json:"completedAt,omitempty"`
	LatencyMs      int64         `json:"latencyMs,omitempty"`
}

// ToolProposal is the transport shape for a mutation proposal emitted by a TS host.
type ToolProposal struct {
	ProposalID       string `json:"proposalId"`
	ToolName         string `json:"toolName"`
	AffectedNoteID   string `json:"affectedNoteId,omitempty"`
	Summary          string `json:"summary"`
	DiffPreview      string `json:"diffPreview,omitempty"`
	ExpectedRevision int    `json:"expectedRevision,omitempty"`
	RollbackToken    string `json:"rollbackToken,omitempty"`
	PayloadJSON      string `json:"payloadJson,omitempty"`
}

// ChatApprovalRequest stores a human approval checkpoint for a run.
type ChatApprovalRequest struct {
	ID               string `json:"id"`
	RunID            string `json:"runId"`
	ToolCallID       string `json:"toolCallId"`
	ToolName         string `json:"toolName"`
	Status           string `json:"status"`
	AffectedNoteID   string `json:"affectedNoteId,omitempty"`
	Summary          string `json:"summary"`
	DiffPreview      string `json:"diffPreview,omitempty"`
	ExpectedRevision int    `json:"expectedRevision,omitempty"`
	RollbackToken    string `json:"rollbackToken,omitempty"`
	ProposalJSON     string `json:"proposalJson,omitempty"`
	DecisionJSON     string `json:"decisionJson,omitempty"`
	CreatedAt        int64  `json:"createdAt"`
	UpdatedAt        int64  `json:"updatedAt"`
}

// ChatRunSnapshot is the full run view returned to the UI.
type ChatRunSnapshot struct {
	Run       *ChatRun               `json:"run"`
	Events    []*ChatRunEvent        `json:"events"`
	ToolCalls []*ChatToolCall        `json:"toolCalls"`
	Approvals []*ChatApprovalRequest `json:"approvals"`
	Evidence  []EvidenceItem         `json:"evidence"`
	Missing   []string               `json:"missingCapabilities"`
}
