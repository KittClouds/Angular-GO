package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kittclouds/gokitt/internal/store"
	"github.com/kittclouds/gokitt/pkg/agent"
)

const (
	defaultRunDeadlineMs  = 8000
	hardRunDeadlineCapMs  = 12000
	maxPlannerIterations  = 4
	maxPlannerToolCalls   = 8
	defaultEvidenceWindow = 12
)

type plannerClient interface {
	ChatWithTools(ctx context.Context, messages []agent.Message, tools []agent.ToolDefinition, systemPrompt string) (*agent.CompletionResult, error)
}

type blockSearchFunc func(ctx context.Context, run *store.ChatRun, query string, limit int) ([]store.EvidenceItem, error)

type SubmittedToolResult struct {
	CallID     string              `json:"callId,omitempty"`
	ToolCallID string              `json:"toolCallId,omitempty"`
	ResultJSON string              `json:"resultJson,omitempty"`
	Error      string              `json:"error,omitempty"`
	Proposal   *store.ToolProposal `json:"proposal,omitempty"`
}

type plannedTool struct {
	Name        string
	Host        store.ChatToolHost
	Class       store.ChatToolClass
	Description string
	Parameters  string
	Execute     func(context.Context, *store.ChatRun, map[string]interface{}) (string, []store.EvidenceItem, error)
}

func (s *ChatService) StartRun(ctx context.Context, threadID, prompt string, options store.RunOptions) (*store.ChatRun, error) {
	thread, err := s.store.GetThread(threadID)
	if err != nil {
		return nil, fmt.Errorf("load thread: %w", err)
	}
	if thread == nil {
		return nil, fmt.Errorf("thread not found: %s", threadID)
	}

	now := time.Now().UnixMilli()
	options = s.normalizeRunOptions(thread, options)
	capabilities, missing := s.buildCapabilityProfile(options)

	missingJSON, _ := json.Marshal(missing)
	run := &store.ChatRun{
		ID:                   generateID(),
		ThreadID:             threadID,
		UserPrompt:           prompt,
		Status:               store.ChatRunQueued,
		Options:              options,
		Capabilities:         capabilities,
		PreparedSystemPrompt: options.BaseSystemPrompt,
		MissingCapabilities:  string(missingJSON),
		DeadlineAt:           now + int64(options.DeadlineMs),
		CreatedAt:            now,
		UpdatedAt:            now,
	}

	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, fmt.Errorf("persist run: %w", err)
	}
	s.addRunEvent(run.ID, "queued", "status", "Run queued", "", "done", 0, "")

	if err := s.launchRunProcessor(ctx, run.ID); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *ChatService) PollRun(runID string) (*store.ChatRunSnapshot, error) {
	return s.loadRunSnapshot(runID)
}

func (s *ChatService) ListRunEvents(threadID string, limit int) ([]*store.ChatRunEvent, error) {
	if limit <= 0 {
		limit = 100
	}

	runs, err := s.store.ListChatRuns(threadID, limit)
	if err != nil {
		return nil, err
	}

	events := make([]*store.ChatRunEvent, 0, limit)
	for _, run := range runs {
		runEvents, err := s.store.ListChatRunEvents(run.ID, limit)
		if err != nil {
			return nil, err
		}
		events = append(events, runEvents...)
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].CreatedAt < events[j].CreatedAt
	})
	if len(events) > limit {
		events = events[len(events)-limit:]
	}
	return events, nil
}

func (s *ChatService) CancelRun(runID string) error {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return err
	}
	if run == nil {
		return fmt.Errorf("run not found: %s", runID)
	}

	now := time.Now().UnixMilli()
	run.Status = store.ChatRunCancelled
	run.CompletedAt = now
	run.UpdatedAt = now
	if err := s.store.UpsertChatRun(run); err != nil {
		return err
	}
	s.addRunEvent(run.ID, "cancelled", "status", "Run cancelled", "", "done", 0, "")

	s.runMu.Lock()
	cancel := s.runCancels[runID]
	s.runMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (s *ChatService) ResumeRun(ctx context.Context, runID string) (*store.ChatRun, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	switch run.Status {
	case store.ChatRunCompleted, store.ChatRunCancelled, store.ChatRunStreaming, store.ChatRunReadyToAnswer:
		return run, nil
	case store.ChatRunAwaitingTool:
		calls, err := s.store.ListChatToolCalls(runID)
		if err != nil {
			return nil, err
		}
		for _, call := range calls {
			if call.Host == store.ChatToolHostTypeScript && (call.Status == "pending_host" || call.Status == "running") {
				return nil, fmt.Errorf("run %s still waiting on external tool host", runID)
			}
		}
	case store.ChatRunAwaitingApproval:
		approvals, err := s.store.ListChatApprovals(runID)
		if err != nil {
			return nil, err
		}
		for _, approval := range approvals {
			if approval.Status == "pending" {
				return nil, fmt.Errorf("run %s still waiting on approval", runID)
			}
		}
	}

	run.Status = store.ChatRunPlanning
	run.UpdatedAt = time.Now().UnixMilli()
	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, err
	}
	s.addRunEvent(run.ID, "planning", "status", "Run resumed", "", "done", 0, "")

	if err := s.launchRunProcessor(ctx, run.ID); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *ChatService) SubmitToolResults(runID string, results []SubmittedToolResult) (*store.ChatRunSnapshot, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	messages := s.parsePlannerMessages(run.PlannerMessagesJSON, run.UserPrompt)
	evidence := s.parseEvidence(run.EvidenceJSON)
	createdApproval := false
	now := time.Now().UnixMilli()

	for _, result := range results {
		call, err := s.resolveToolCall(runID, result)
		if err != nil {
			return nil, err
		}
		if call == nil {
			continue
		}

		call.CompletedAt = now
		if call.StartedAt > 0 {
			call.LatencyMs = now - call.StartedAt
		}

		switch {
		case result.Error != "":
			call.Status = "failed"
			call.Error = result.Error
			call.ResultJSON = normalizeJSONPayload(result.Error)
			messages = appendToolMessage(messages, call.ToolCallID, call.ResultJSON)
			s.addRunEvent(run.ID, "executing_tools", "tool", call.ToolName, result.Error, "error", call.LatencyMs, call.ResultJSON)
		case result.Proposal != nil:
			createdApproval = true
			approvalID := result.Proposal.ProposalID
			if approvalID == "" {
				approvalID = generateID()
				result.Proposal.ProposalID = approvalID
			}
			proposalJSON, _ := json.Marshal(result.Proposal)
			approval := &store.ChatApprovalRequest{
				ID:               approvalID,
				RunID:            runID,
				ToolCallID:       call.ToolCallID,
				ToolName:         call.ToolName,
				Status:           "pending",
				AffectedNoteID:   result.Proposal.AffectedNoteID,
				Summary:          result.Proposal.Summary,
				DiffPreview:      result.Proposal.DiffPreview,
				ExpectedRevision: result.Proposal.ExpectedRevision,
				RollbackToken:    result.Proposal.RollbackToken,
				ProposalJSON:     string(proposalJSON),
				CreatedAt:        now,
				UpdatedAt:        now,
			}
			if err := s.store.UpsertChatApproval(approval); err != nil {
				return nil, err
			}
			call.ApprovalID = approvalID
			call.Status = "awaiting_approval"
			s.addRunEvent(run.ID, "awaiting_approval", "tool", call.ToolName, result.Proposal.Summary, "running", call.LatencyMs, string(proposalJSON))
		default:
			call.Status = "completed"
			call.ResultJSON = normalizeJSONPayload(result.ResultJSON)
			messages = appendToolMessage(messages, call.ToolCallID, call.ResultJSON)
			evidence = append(evidence, makeToolEvidence(run.ID, call.ToolName, call.ResultJSON))
			s.addRunEvent(run.ID, "executing_tools", "tool", call.ToolName, "Tool host returned result", "done", call.LatencyMs, call.ResultJSON)
		}

		if err := s.store.UpsertChatToolCall(call); err != nil {
			return nil, err
		}
	}

	run.PlannerMessagesJSON = mustJSON(messages)
	run.EvidenceJSON = mustJSON(evidence)
	run.PreparedContext = buildPreparedContext(evidence)
	run.PreparedSystemPrompt = buildPreparedSystemPrompt(run.Options.BaseSystemPrompt, run.PreparedContext)
	run.UpdatedAt = now
	if createdApproval {
		run.Status = store.ChatRunAwaitingApproval
	} else {
		run.Status = store.ChatRunPlanning
	}

	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, err
	}
	return s.loadRunSnapshot(runID)
}

func (s *ChatService) SubmitApproval(runID, approvalID string, approved bool, decisionJSON string) (*store.ChatRunSnapshot, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	approval, err := s.store.GetChatApproval(approvalID)
	if err != nil {
		return nil, err
	}
	if approval == nil {
		return nil, fmt.Errorf("approval not found: %s", approvalID)
	}

	status := "rejected"
	if approved {
		status = "approved"
	}
	now := time.Now().UnixMilli()
	if strings.TrimSpace(decisionJSON) == "" {
		decisionJSON = mustJSON(map[string]bool{"approved": approved})
	} else {
		decisionJSON = normalizeJSONPayload(decisionJSON)
	}

	approval.Status = status
	approval.DecisionJSON = decisionJSON
	approval.UpdatedAt = now
	if err := s.store.UpsertChatApproval(approval); err != nil {
		return nil, err
	}

	call, err := s.store.FindChatToolCall(runID, approval.ToolCallID)
	if err != nil {
		return nil, err
	}
	if call != nil {
		call.Status = status
		call.ResultJSON = decisionJSON
		call.CompletedAt = now
		if call.StartedAt > 0 {
			call.LatencyMs = now - call.StartedAt
		}
		if err := s.store.UpsertChatToolCall(call); err != nil {
			return nil, err
		}
	}

	messages := s.parsePlannerMessages(run.PlannerMessagesJSON, run.UserPrompt)
	if approval.ToolCallID != "" {
		messages = appendToolMessage(messages, approval.ToolCallID, decisionJSON)
	}

	evidence := s.parseEvidence(run.EvidenceJSON)
	if approved {
		evidence = append(evidence, makeToolEvidence(run.ID, approval.ToolName, decisionJSON))
	}

	run.PlannerMessagesJSON = mustJSON(messages)
	run.EvidenceJSON = mustJSON(evidence)
	run.PreparedContext = buildPreparedContext(evidence)
	run.PreparedSystemPrompt = buildPreparedSystemPrompt(run.Options.BaseSystemPrompt, run.PreparedContext)
	run.Status = store.ChatRunPlanning
	run.UpdatedAt = now
	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, err
	}

	detail := "Proposal rejected"
	if approved {
		detail = "Proposal approved"
	}
	s.addRunEvent(run.ID, "awaiting_approval", "status", approval.ToolName, detail, "done", 0, decisionJSON)
	return s.loadRunSnapshot(runID)
}

func (s *ChatService) MarkRunStreaming(runID, assistantMessageID string) (*store.ChatRunSnapshot, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	run.Status = store.ChatRunStreaming
	run.AssistantMessageID = assistantMessageID
	run.UpdatedAt = time.Now().UnixMilli()
	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, err
	}
	s.addRunEvent(run.ID, "streaming", "status", "Streaming reply", "", "running", 0, "")
	return s.loadRunSnapshot(runID)
}

func (s *ChatService) CompleteRun(runID, assistantMessageID, finalResponse, finalErr string) (*store.ChatRunSnapshot, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	now := time.Now().UnixMilli()
	run.AssistantMessageID = assistantMessageID
	run.FinalResponse = finalResponse
	run.CompletedAt = now
	run.UpdatedAt = now
	if strings.TrimSpace(finalErr) != "" {
		run.Status = store.ChatRunFailed
		run.Error = finalErr
		s.addRunEvent(run.ID, "streaming", "status", "Run failed", finalErr, "error", 0, "")
	} else {
		run.Status = store.ChatRunCompleted
		s.addRunEvent(run.ID, "completed", "status", "Run completed", "", "done", 0, "")
	}

	if err := s.store.UpsertChatRun(run); err != nil {
		return nil, err
	}
	return s.loadRunSnapshot(runID)
}

func (s *ChatService) launchRunProcessor(parent context.Context, runID string) error {
	s.runMu.Lock()
	if s.runActive[runID] {
		s.runMu.Unlock()
		return nil
	}

	baseCtx := parent
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(baseCtx)
	s.runActive[runID] = true
	s.runCancels[runID] = cancel
	s.runMu.Unlock()

	go func() {
		defer func() {
			cancel()
			s.runMu.Lock()
			delete(s.runActive, runID)
			delete(s.runCancels, runID)
			s.runMu.Unlock()
		}()

		run, err := s.store.GetChatRun(runID)
		if err != nil || run == nil {
			return
		}

		runCtx := ctx
		if run.DeadlineAt > 0 {
			var deadlineCancel context.CancelFunc
			runCtx, deadlineCancel = context.WithDeadline(ctx, time.UnixMilli(run.DeadlineAt))
			defer deadlineCancel()
		}

		if err := s.processRun(runCtx, runID); err != nil {
			if runCtx.Err() == context.DeadlineExceeded {
				_ = s.markRunAnswerable(runID, true, "pre-reply deadline reached")
				return
			}
			_ = s.failRun(runID, err.Error())
		}
	}()

	return nil
}

func (s *ChatService) processRun(ctx context.Context, runID string) error {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return err
	}
	if run == nil {
		return fmt.Errorf("run not found: %s", runID)
	}
	if run.Status == store.ChatRunCancelled || run.Status == store.ChatRunCompleted {
		return nil
	}

	if run.Status == store.ChatRunQueued || run.Status == store.ChatRunGathering || strings.TrimSpace(run.EvidenceJSON) == "" {
		if err := s.gatherDeterministicContext(ctx, run); err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return ctx.Err()
			}
			return err
		}
		run, err = s.store.GetChatRun(runID)
		if err != nil {
			return err
		}
	}

	if run == nil || run.Status == store.ChatRunCancelled {
		return nil
	}
	if !run.Options.PlannerEnabled || !run.Capabilities.PlannerEnabled || s.planner == nil {
		return s.markRunAnswerable(runID, false, "")
	}

	return s.executePlanner(ctx, runID)
}

func (s *ChatService) gatherDeterministicContext(ctx context.Context, run *store.ChatRun) error {
	thread, err := s.store.GetThread(run.ThreadID)
	if err != nil {
		return err
	}

	run.Status = store.ChatRunGathering
	run.UpdatedAt = time.Now().UnixMilli()
	if err := s.store.UpsertChatRun(run); err != nil {
		return err
	}
	s.addRunEvent(run.ID, "gathering", "status", "Gathering context", "", "running", 0, "")

	evidence := s.parseEvidence(run.EvidenceJSON)
	missing := s.parseMissingCapabilities(run.MissingCapabilities)

	threadMessages, err := s.store.GetThreadMessages(run.ThreadID)
	if err != nil {
		return err
	}
	evidence = append(evidence, store.EvidenceItem{
		ID:      generateID(),
		Source:  "thread_context",
		Title:   "Recent conversation",
		Content: formatThreadMessages(threadMessages, defaultEvidenceWindow),
	})

	if ext := strings.TrimSpace(run.Options.InitialExternalContext); ext != "" {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "external_context",
			Title:   "UI supplied context",
			Content: ext,
		})
	}

	if run.Options.OMEnabled {
		if s.observer != nil && s.observer.IsEnabled() {
			if err := s.observer.ProcessLoop(ctx, run.ThreadID); err != nil {
				missing = appendMissingCapability(missing, "om")
			}
		} else {
			missing = appendMissingCapability(missing, "om")
		}

		if record, err := s.store.GetOMRecord(run.ThreadID); err == nil && record != nil && strings.TrimSpace(record.Observations) != "" {
			evidence = append(evidence, store.EvidenceItem{
				ID:      generateID(),
				Source:  "om_context",
				Title:   "Observational memory",
				Content: record.Observations,
			})
		}
	}

	if run.Options.WorkspaceEnabled {
		scopeID := run.Options.ScopeID
		if scopeID == "" && thread != nil {
			scopeID = thread.NarrativeID
		}

		if resultJSON, items, err := s.execSearchNotes(ctx, run, map[string]interface{}{
			"query": run.UserPrompt,
			"limit": 6,
		}); err == nil {
			evidence = append(evidence, items...)
			s.addRunEvent(run.ID, "gathering", "tool", "search_notes_qgram", "Searched scoped notes", "done", 0, resultJSON)
		}

		if resultJSON, items, err := s.execSearchBlocksGDR(ctx, run, map[string]interface{}{
			"query": run.UserPrompt,
			"limit": 5,
		}); err == nil {
			evidence = append(evidence, items...)
			s.addRunEvent(run.ID, "gathering", "tool", "search_blocks_gdr", "Queried graph lexical index", "done", 0, resultJSON)
		} else if s.blockSearcher == nil {
			missing = appendMissingCapability(missing, "gdr")
		}

		if resultJSON, items, err := s.execSearchBlocksGraptor(ctx, run, map[string]interface{}{
			"query": run.UserPrompt,
			"limit": 5,
		}); err == nil {
			evidence = append(evidence, items...)
			s.addRunEvent(run.ID, "gathering", "tool", "search_blocks_graptor", "Queried Graptor retriever", "done", 0, resultJSON)
		}

		if resultJSON, items, err := s.execFetchEpisodes(ctx, run, map[string]interface{}{
			"query":    run.UserPrompt,
			"scope_id": scopeID,
			"limit":    5,
		}); err == nil {
			evidence = append(evidence, items...)
			s.addRunEvent(run.ID, "gathering", "tool", "fetch_episodes", "Loaded recent episodes", "done", 0, resultJSON)
		}

		if resultJSON, items, err := s.execGetWorkspaceArtifacts(ctx, run, map[string]interface{}{}); err == nil {
			evidence = append(evidence, items...)
			if len(items) > 0 {
				s.addRunEvent(run.ID, "gathering", "tool", "get_workspace_artifacts", "Loaded pinned workspace artifacts", "done", 0, resultJSON)
			}
		}
	}

	run.EvidenceJSON = mustJSON(evidence)
	run.MissingCapabilities = mustJSON(missing)
	run.PreparedContext = buildPreparedContext(evidence)
	run.PreparedSystemPrompt = buildPreparedSystemPrompt(run.Options.BaseSystemPrompt, run.PreparedContext)
	run.Status = store.ChatRunPlanning
	run.UpdatedAt = time.Now().UnixMilli()
	if err := s.store.UpsertChatRun(run); err != nil {
		return err
	}
	s.addRunEvent(run.ID, "gathering", "status", "Context ready", "", "done", 0, "")
	return nil
}

func (s *ChatService) executePlanner(ctx context.Context, runID string) error {
	registry := s.buildPlannerRegistry()
	tools := make([]agent.ToolDefinition, 0, len(registry))
	for _, tool := range registry {
		tools = append(tools, agent.ToolDefinition{
			Type: "function",
			Function: agent.ToolFunctionSchema{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  json.RawMessage(tool.Parameters),
			},
		})
	}

	if len(tools) == 0 {
		return s.markRunAnswerable(runID, false, "")
	}

	for iteration := 0; iteration < maxPlannerIterations; iteration++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		run, err := s.store.GetChatRun(runID)
		if err != nil {
			return err
		}
		if run == nil {
			return fmt.Errorf("run not found: %s", runID)
		}
		if run.Status == store.ChatRunCancelled {
			return nil
		}

		calls, err := s.store.ListChatToolCalls(runID)
		if err != nil {
			return err
		}
		if len(calls) >= maxPlannerToolCalls {
			return s.markRunAnswerable(runID, true, "tool budget exhausted")
		}

		messages := s.parsePlannerMessages(run.PlannerMessagesJSON, run.UserPrompt)
		run.Status = store.ChatRunPlanning
		run.UpdatedAt = time.Now().UnixMilli()
		if err := s.store.UpsertChatRun(run); err != nil {
			return err
		}

		resp, err := s.planner.ChatWithTools(ctx, messages, tools, buildPlannerSystemPrompt(run))
		if err != nil {
			return s.markRunAnswerable(runID, true, fmt.Sprintf("planner unavailable: %v", err))
		}

		assistantMsg := agent.Message{
			Role:      "assistant",
			Content:   resp.Content,
			ToolCalls: resp.ToolCalls,
		}
		messages = append(messages, assistantMsg)

		run.PlannerMessagesJSON = mustJSON(messages)
		run.UpdatedAt = time.Now().UnixMilli()
		if err := s.store.UpsertChatRun(run); err != nil {
			return err
		}

		if len(resp.ToolCalls) == 0 {
			return s.markRunAnswerable(runID, false, "")
		}

		evidence := s.parseEvidence(run.EvidenceJSON)
		externalPending := false

		for _, toolCall := range resp.ToolCalls {
			tool, ok := registry[toolCall.Function.Name]
			if !ok {
				payload := mustJSON(map[string]string{"error": "unknown tool"})
				messages = appendToolMessage(messages, toolCall.ID, payload)
				continue
			}

			arguments := parseArguments(toolCall.Function.Arguments)
			now := time.Now().UnixMilli()
			callRecord := &store.ChatToolCall{
				ID:             generateID(),
				RunID:          runID,
				ToolCallID:     toolCall.ID,
				ToolName:       tool.Name,
				Host:           tool.Host,
				Class:          tool.Class,
				ArgumentsJSON:  normalizeJSONPayload(toolCall.Function.Arguments),
				IdempotencyKey: fmt.Sprintf("%s:%s", runID, toolCall.ID),
				StartedAt:      now,
			}

			if tool.Host == store.ChatToolHostTypeScript {
				callRecord.Status = "pending_host"
				if err := s.store.UpsertChatToolCall(callRecord); err != nil {
					return err
				}
				externalPending = true
				s.addRunEvent(run.ID, "awaiting_tool_host", "tool", tool.Name, "Waiting for TypeScript host", "running", 0, callRecord.ArgumentsJSON)
				continue
			}

			callRecord.Status = "running"
			if err := s.store.UpsertChatToolCall(callRecord); err != nil {
				return err
			}

			run.Status = store.ChatRunExecutingTools
			run.UpdatedAt = now
			if err := s.store.UpsertChatRun(run); err != nil {
				return err
			}

			resultJSON, items, err := tool.Execute(ctx, run, arguments)
			callRecord.CompletedAt = time.Now().UnixMilli()
			callRecord.LatencyMs = callRecord.CompletedAt - callRecord.StartedAt
			if err != nil {
				callRecord.Status = "failed"
				callRecord.Error = err.Error()
				callRecord.ResultJSON = mustJSON(map[string]string{"error": err.Error()})
				s.addRunEvent(run.ID, "executing_tools", "tool", tool.Name, err.Error(), "error", callRecord.LatencyMs, callRecord.ResultJSON)
				messages = appendToolMessage(messages, toolCall.ID, callRecord.ResultJSON)
			} else {
				callRecord.Status = "completed"
				callRecord.ResultJSON = normalizeJSONPayload(resultJSON)
				evidence = append(evidence, items...)
				s.addRunEvent(run.ID, "executing_tools", "tool", tool.Name, "Tool completed", "done", callRecord.LatencyMs, callRecord.ResultJSON)
				messages = appendToolMessage(messages, toolCall.ID, callRecord.ResultJSON)
			}

			if err := s.store.UpsertChatToolCall(callRecord); err != nil {
				return err
			}
		}

		run.PlannerMessagesJSON = mustJSON(messages)
		run.EvidenceJSON = mustJSON(evidence)
		run.PreparedContext = buildPreparedContext(evidence)
		run.PreparedSystemPrompt = buildPreparedSystemPrompt(run.Options.BaseSystemPrompt, run.PreparedContext)
		run.UpdatedAt = time.Now().UnixMilli()
		if externalPending {
			run.Status = store.ChatRunAwaitingTool
		} else {
			run.Status = store.ChatRunPlanning
		}
		if err := s.store.UpsertChatRun(run); err != nil {
			return err
		}
		if externalPending {
			return nil
		}
	}

	return s.markRunAnswerable(runID, true, "planner iteration limit reached")
}

func (s *ChatService) buildPlannerRegistry() map[string]plannedTool {
	return map[string]plannedTool{
		"search_notes_qgram": {
			Name:        "search_notes_qgram",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Search scoped notes using the qgram lexical index.",
			Parameters:  `{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"},"narrativeId":{"type":"string"},"folderId":{"type":"string"}},"required":["query"]}`,
			Execute:     s.execSearchNotes,
		},
		"search_blocks_gdr": {
			Name:        "search_blocks_gdr",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Search graph-aware block retrieval results from the GLDR index.",
			Parameters:  `{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}`,
			Execute:     s.execSearchBlocksGDR,
		},
		"search_blocks_graptor": {
			Name:        "search_blocks_graptor",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Search Graptor retrieval results for matching chunks.",
			Parameters:  `{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer"}},"required":["query"]}`,
			Execute:     s.execSearchBlocksGraptor,
		},
		"fetch_episodes": {
			Name:        "fetch_episodes",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Fetch recent or matching episodes within the active narrative scope.",
			Parameters:  `{"type":"object","properties":{"query":{"type":"string"},"scope_id":{"type":"string"},"limit":{"type":"integer"}}}`,
			Execute:     s.execFetchEpisodes,
		},
		"get_om_context": {
			Name:        "get_om_context",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Read the observational memory summary for the current thread.",
			Parameters:  `{"type":"object","properties":{}}`,
			Execute:     s.execGetOMContext,
		},
		"get_thread_context": {
			Name:        "get_thread_context",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Read recent messages from the current thread.",
			Parameters:  `{"type":"object","properties":{"limit":{"type":"integer"}}}`,
			Execute:     s.execGetThreadContext,
		},
		"get_scoped_note": {
			Name:        "get_scoped_note",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Read a note by ID when it matches the active scope.",
			Parameters:  `{"type":"object","properties":{"noteId":{"type":"string"}},"required":["noteId"]}`,
			Execute:     s.execGetScopedNote,
		},
		"list_scoped_notes": {
			Name:        "list_scoped_notes",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "List notes inside the active folder or narrative scope.",
			Parameters:  `{"type":"object","properties":{"limit":{"type":"integer"},"folderId":{"type":"string"},"narrativeId":{"type":"string"}}}`,
			Execute:     s.execListScopedNotes,
		},
		"get_workspace_artifacts": {
			Name:        "get_workspace_artifacts",
			Host:        store.ChatToolHostGo,
			Class:       store.ChatToolClassRead,
			Description: "Read pinned workspace artifacts for the active thread and folder scope.",
			Parameters:  `{"type":"object","properties":{}}`,
			Execute:     s.execGetWorkspaceArtifacts,
		},
		"get_active_note_snapshot": {
			Name:        "get_active_note_snapshot",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassRead,
			Description: "Return the active note snapshot from the editor.",
			Parameters:  `{"type":"object","properties":{}}`,
		},
		"get_selection": {
			Name:        "get_selection",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassRead,
			Description: "Return the current editor selection.",
			Parameters:  `{"type":"object","properties":{}}`,
		},
		"replace_text_proposal": {
			Name:        "replace_text_proposal",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassProposal,
			Description: "Propose replacing text in the active note without applying it.",
			Parameters:  `{"type":"object","properties":{"from":{"type":"integer"},"to":{"type":"integer"},"replacement":{"type":"string"},"expectedRevision":{"type":"integer"}},"required":["from","to","replacement"]}`,
		},
		"rewrite_block_proposal": {
			Name:        "rewrite_block_proposal",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassProposal,
			Description: "Propose replacing a block in the active note without applying it.",
			Parameters:  `{"type":"object","properties":{"blockIndex":{"type":"integer"},"replacement":{"type":"string"},"expectedRevision":{"type":"integer"}},"required":["blockIndex","replacement"]}`,
		},
		"insert_text_proposal": {
			Name:        "insert_text_proposal",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassProposal,
			Description: "Propose inserting text in the active note without applying it.",
			Parameters:  `{"type":"object","properties":{"pos":{"type":"integer"},"text":{"type":"string"},"expectedRevision":{"type":"integer"}},"required":["pos","text"]}`,
		},
		"save_note_proposal": {
			Name:        "save_note_proposal",
			Host:        store.ChatToolHostTypeScript,
			Class:       store.ChatToolClassProposal,
			Description: "Propose saving the current editor state.",
			Parameters:  `{"type":"object","properties":{}}`,
		},
	}
}

func (s *ChatService) execSearchNotes(_ context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	query := stringArg(args, "query", run.UserPrompt)
	limit := intArg(args, "limit", 6)
	narrativeID := stringArg(args, "narrativeId", run.Options.NarrativeID)
	folderID := stringArg(args, "folderId", run.Options.FolderID)

	notes, err := s.store.SearchNotes(&store.ScopeKey{
		ThreadID:    run.ThreadID,
		NarrativeID: narrativeID,
		FolderID:    folderID,
	}, query, limit)
	if err != nil {
		return "", nil, err
	}

	type noteHit struct {
		ID          string `json:"id"`
		Title       string `json:"title"`
		Snippet     string `json:"snippet"`
		NarrativeID string `json:"narrativeId,omitempty"`
		FolderID    string `json:"folderId,omitempty"`
	}

	hits := make([]noteHit, 0, len(notes))
	lines := make([]string, 0, len(notes))
	for _, note := range notes {
		snippet := truncateText(strings.TrimSpace(firstNonEmpty(note.MarkdownContent, note.Content)), 280)
		hits = append(hits, noteHit{
			ID:          note.ID,
			Title:       note.Title,
			Snippet:     snippet,
			NarrativeID: note.NarrativeID,
			FolderID:    note.FolderID,
		})
		lines = append(lines, fmt.Sprintf("- %s (%s): %s", firstNonEmpty(note.Title, note.ID), note.ID, snippet))
	}

	evidence := []store.EvidenceItem{}
	if len(lines) > 0 {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "search_notes_qgram",
			Title:   "Scoped note matches",
			Content: strings.Join(lines, "\n"),
		})
	}
	return mustJSON(hits), evidence, nil
}

func (s *ChatService) execSearchBlocksGDR(ctx context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	if s.blockSearcher == nil {
		return "", nil, fmt.Errorf("gdr search unavailable")
	}
	query := stringArg(args, "query", run.UserPrompt)
	limit := intArg(args, "limit", 5)
	items, err := s.blockSearcher(ctx, run, query, limit)
	if err != nil {
		return "", nil, err
	}
	return mustJSON(items), items, nil
}

func (s *ChatService) execSearchBlocksGraptor(ctx context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	searcher := s.graptorSearcher
	if searcher == nil {
		searcher = s.blockSearcher
	}
	if searcher == nil {
		return "", nil, fmt.Errorf("graptor search unavailable")
	}
	query := stringArg(args, "query", run.UserPrompt)
	limit := intArg(args, "limit", 5)
	items, err := searcher(ctx, run, query, limit)
	if err != nil {
		return "", nil, err
	}
	for i := range items {
		if items[i].Source == "" {
			items[i].Source = "search_blocks_graptor"
		}
	}
	return mustJSON(items), items, nil
}

func (s *ChatService) execFetchEpisodes(_ context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	scopeID := stringArg(args, "scope_id", run.Options.ScopeID)
	if scopeID == "" {
		scopeID = run.Options.NarrativeID
	}
	if scopeID == "" {
		thread, _ := s.store.GetThread(run.ThreadID)
		if thread != nil {
			scopeID = thread.NarrativeID
		}
	}
	query := stringArg(args, "query", "")
	limit := intArg(args, "limit", 5)

	var (
		episodes []*store.Episode
		err      error
	)
	if query != "" {
		episodes, err = s.store.SearchEpisodes(scopeID, query, limit)
	} else {
		episodes, err = s.store.GetEpisodes(scopeID, limit)
	}
	if err != nil {
		return "", nil, err
	}

	lines := make([]string, 0, len(episodes))
	for _, episode := range episodes {
		lines = append(lines, fmt.Sprintf("- [%s] %s %s", episode.ActionType, episode.TargetKind, episode.TargetID))
	}

	evidence := []store.EvidenceItem{}
	if len(lines) > 0 {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "fetch_episodes",
			Title:   "Recent activity",
			Content: strings.Join(lines, "\n"),
		})
	}
	return mustJSON(episodes), evidence, nil
}

func (s *ChatService) execGetOMContext(_ context.Context, run *store.ChatRun, _ map[string]interface{}) (string, []store.EvidenceItem, error) {
	record, err := s.store.GetOMRecord(run.ThreadID)
	if err != nil {
		return "", nil, err
	}
	if record == nil {
		return "null", nil, nil
	}
	evidence := []store.EvidenceItem{}
	if strings.TrimSpace(record.Observations) != "" {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "get_om_context",
			Title:   "Observational memory",
			Content: record.Observations,
		})
	}
	return mustJSON(record), evidence, nil
}

func (s *ChatService) execGetThreadContext(_ context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	messages, err := s.store.GetThreadMessages(run.ThreadID)
	if err != nil {
		return "", nil, err
	}
	limit := intArg(args, "limit", defaultEvidenceWindow)
	content := formatThreadMessages(messages, limit)
	evidence := []store.EvidenceItem{{
		ID:      generateID(),
		Source:  "get_thread_context",
		Title:   "Recent conversation",
		Content: content,
	}}
	return mustJSON(messages), evidence, nil
}

func (s *ChatService) execGetScopedNote(_ context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	noteID := stringArg(args, "noteId", "")
	if noteID == "" {
		return "", nil, fmt.Errorf("noteId is required")
	}
	note, err := s.store.GetNote(noteID)
	if err != nil {
		return "", nil, err
	}
	if note == nil {
		return "null", nil, nil
	}
	if run.Options.NarrativeID != "" && note.NarrativeID != "" && note.NarrativeID != run.Options.NarrativeID {
		return "null", nil, nil
	}
	if run.Options.FolderID != "" && note.FolderID != "" && note.FolderID != run.Options.FolderID {
		return "null", nil, nil
	}
	content := truncateText(strings.TrimSpace(firstNonEmpty(note.MarkdownContent, note.Content)), 1200)
	evidence := []store.EvidenceItem{{
		ID:      generateID(),
		Source:  "get_scoped_note",
		Title:   firstNonEmpty(note.Title, note.ID),
		Content: content,
	}}
	return mustJSON(note), evidence, nil
}

func (s *ChatService) execListScopedNotes(_ context.Context, run *store.ChatRun, args map[string]interface{}) (string, []store.EvidenceItem, error) {
	folderID := stringArg(args, "folderId", run.Options.FolderID)
	narrativeID := stringArg(args, "narrativeId", run.Options.NarrativeID)
	limit := intArg(args, "limit", 10)
	notes, err := s.store.ListNotes(folderID)
	if err != nil {
		return "", nil, err
	}
	if limit > 0 && len(notes) > limit {
		notes = notes[:limit]
	}

	type noteRef struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		FolderID string `json:"folderId,omitempty"`
	}
	refs := make([]noteRef, 0, len(notes))
	lines := make([]string, 0, len(notes))
	for _, note := range notes {
		if narrativeID != "" && note.NarrativeID != "" && note.NarrativeID != narrativeID {
			continue
		}
		refs = append(refs, noteRef{ID: note.ID, Title: note.Title, FolderID: note.FolderID})
		lines = append(lines, fmt.Sprintf("- %s (%s)", firstNonEmpty(note.Title, note.ID), note.ID))
	}

	evidence := []store.EvidenceItem{}
	if len(lines) > 0 {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "list_scoped_notes",
			Title:   "Available scoped notes",
			Content: strings.Join(lines, "\n"),
		})
	}
	return mustJSON(refs), evidence, nil
}

func (s *ChatService) execGetWorkspaceArtifacts(_ context.Context, run *store.ChatRun, _ map[string]interface{}) (string, []store.EvidenceItem, error) {
	arts, err := s.store.ListArtifacts(&store.ScopeKey{
		ThreadID:    run.ThreadID,
		NarrativeID: run.Options.NarrativeID,
		FolderID:    run.Options.FolderID,
	})
	if err != nil {
		return "", nil, err
	}

	lines := make([]string, 0, len(arts))
	filtered := make([]*store.WorkspaceArtifact, 0, len(arts))
	for _, art := range arts {
		if !art.Pinned {
			continue
		}
		filtered = append(filtered, art)
		lines = append(lines, fmt.Sprintf("- %s (%s): %s", art.Key, art.Kind, truncateText(strings.TrimSpace(art.Payload), 240)))
	}

	evidence := []store.EvidenceItem{}
	if len(lines) > 0 {
		evidence = append(evidence, store.EvidenceItem{
			ID:      generateID(),
			Source:  "get_workspace_artifacts",
			Title:   "Pinned workspace artifacts",
			Content: strings.Join(lines, "\n"),
		})
	}
	return mustJSON(filtered), evidence, nil
}

func (s *ChatService) resolveToolCall(runID string, result SubmittedToolResult) (*store.ChatToolCall, error) {
	if result.CallID != "" {
		call, err := s.store.GetChatToolCall(result.CallID)
		if err != nil {
			return nil, err
		}
		if call != nil && call.RunID == runID {
			return call, nil
		}
	}
	if result.ToolCallID != "" {
		return s.store.FindChatToolCall(runID, result.ToolCallID)
	}
	return nil, nil
}

func (s *ChatService) loadRunSnapshot(runID string) (*store.ChatRunSnapshot, error) {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	events, err := s.store.ListChatRunEvents(runID, 200)
	if err != nil {
		return nil, err
	}
	calls, err := s.store.ListChatToolCalls(runID)
	if err != nil {
		return nil, err
	}
	approvals, err := s.store.ListChatApprovals(runID)
	if err != nil {
		return nil, err
	}

	return &store.ChatRunSnapshot{
		Run:       run,
		Events:    events,
		ToolCalls: calls,
		Approvals: approvals,
		Evidence:  s.parseEvidence(run.EvidenceJSON),
		Missing:   s.parseMissingCapabilities(run.MissingCapabilities),
	}, nil
}

func (s *ChatService) buildCapabilityProfile(options store.RunOptions) (store.CapabilityProfile, []string) {
	caps := store.CapabilityProfile{
		OMEnabled:        options.OMEnabled && s.observer != nil && s.observer.IsEnabled(),
		WorkspaceEnabled: options.WorkspaceEnabled,
		PlannerEnabled:   options.PlannerEnabled && s.planner != nil,
		GoToolHost:       true,
		TSToolHost:       true,
		BlockSearch:      s.blockSearcher != nil || s.graptorSearcher != nil,
	}

	missing := make([]string, 0, 4)
	if options.OMEnabled && !caps.OMEnabled {
		missing = append(missing, "om")
	}
	if options.PlannerEnabled && !caps.PlannerEnabled {
		missing = append(missing, "planner")
	}
	if options.WorkspaceEnabled && !caps.BlockSearch {
		missing = append(missing, "block_search")
	}
	return caps, missing
}

func (s *ChatService) normalizeRunOptions(thread *store.Thread, options store.RunOptions) store.RunOptions {
	if options.DeadlineMs <= 0 {
		options.DeadlineMs = defaultRunDeadlineMs
	}
	if options.DeadlineMs > hardRunDeadlineCapMs {
		options.DeadlineMs = hardRunDeadlineCapMs
	}
	if options.MutationPolicy == "" {
		options.MutationPolicy = store.ChatMutationConfirm
	}
	if options.NarrativeID == "" && thread != nil {
		options.NarrativeID = thread.NarrativeID
	}
	if options.ScopeID == "" {
		options.ScopeID = options.NarrativeID
	}
	return options
}

func (s *ChatService) markRunAnswerable(runID string, degraded bool, detail string) error {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return err
	}
	if run == nil {
		return fmt.Errorf("run not found: %s", runID)
	}

	if degraded {
		missing := appendMissingCapability(s.parseMissingCapabilities(run.MissingCapabilities), detail)
		run.MissingCapabilities = mustJSON(missing)
		run.Status = store.ChatRunDegraded
	} else {
		run.Status = store.ChatRunReadyToAnswer
	}

	run.UpdatedAt = time.Now().UnixMilli()
	if err := s.store.UpsertChatRun(run); err != nil {
		return err
	}

	label := "Ready to answer"
	if degraded {
		label = "Reply ready with degraded context"
	}
	s.addRunEvent(run.ID, "ready_to_answer", "status", label, detail, "done", 0, "")
	return nil
}

func (s *ChatService) failRun(runID, reason string) error {
	run, err := s.store.GetChatRun(runID)
	if err != nil {
		return err
	}
	if run == nil {
		return fmt.Errorf("run not found: %s", runID)
	}

	now := time.Now().UnixMilli()
	run.Status = store.ChatRunFailed
	run.Error = reason
	run.CompletedAt = now
	run.UpdatedAt = now
	if err := s.store.UpsertChatRun(run); err != nil {
		return err
	}
	s.addRunEvent(run.ID, "failed", "status", "Run failed", reason, "error", 0, "")
	return nil
}

func (s *ChatService) addRunEvent(runID, phase, kind, label, detail, status string, latencyMs int64, payload string) {
	_ = s.store.AddChatRunEvent(&store.ChatRunEvent{
		ID:        generateID(),
		RunID:     runID,
		Phase:     phase,
		Kind:      kind,
		Label:     label,
		Detail:    detail,
		Status:    status,
		Payload:   payload,
		LatencyMs: latencyMs,
		CreatedAt: time.Now().UnixMilli(),
	})
}

func (s *ChatService) parseEvidence(raw string) []store.EvidenceItem {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var items []store.EvidenceItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}
	return items
}

func (s *ChatService) parseMissingCapabilities(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var missing []string
	if err := json.Unmarshal([]byte(raw), &missing); err != nil {
		return nil
	}
	return missing
}

func (s *ChatService) parsePlannerMessages(raw, fallbackPrompt string) []agent.Message {
	if strings.TrimSpace(raw) == "" {
		content := fallbackPrompt
		return []agent.Message{{Role: "user", Content: &content}}
	}

	var messages []agent.Message
	if err := json.Unmarshal([]byte(raw), &messages); err != nil || len(messages) == 0 {
		content := fallbackPrompt
		return []agent.Message{{Role: "user", Content: &content}}
	}
	return messages
}

func buildPreparedSystemPrompt(basePrompt, preparedContext string) string {
	base := strings.TrimSpace(basePrompt)
	if preparedContext == "" {
		return base
	}
	if base == "" {
		return "Use the gathered evidence below when answering the user.\n\n" + preparedContext
	}
	return base + "\n\nUse the gathered evidence below when answering the user. Prefer retrieved facts over guesses.\n\n" + preparedContext
}

func buildPlannerSystemPrompt(run *store.ChatRun) string {
	var sb strings.Builder
	sb.WriteString("You are the planning phase of a hybrid chat orchestrator.\n")
	sb.WriteString("Use tools to gather evidence before the final answer is streamed by another model.\n")
	sb.WriteString("Return tool calls when more evidence is needed. When enough evidence exists, stop calling tools.\n")
	sb.WriteString("Read-only tools can run automatically. Proposal tools must only be used when the user is explicitly asking to edit notes.\n")
	sb.WriteString("Never assume editor mutations are already applied. Proposal tools only create approval requests.\n")
	if strings.TrimSpace(run.PreparedContext) != "" {
		sb.WriteString("\nGathered evidence so far:\n")
		sb.WriteString(run.PreparedContext)
	}
	return sb.String()
}

func buildPreparedContext(evidence []store.EvidenceItem) string {
	if len(evidence) == 0 {
		return ""
	}
	var sb strings.Builder
	for _, item := range evidence {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = strings.TrimSpace(item.Source)
		}
		if title == "" {
			title = "Evidence"
		}
		sb.WriteString("## ")
		sb.WriteString(title)
		sb.WriteString("\n")
		sb.WriteString(strings.TrimSpace(item.Content))
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String())
}

func formatThreadMessages(messages []*store.ThreadMessage, limit int) string {
	if len(messages) == 0 {
		return ""
	}
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}

	lines := make([]string, 0, len(messages))
	for _, message := range messages {
		role := strings.Title(message.Role)
		lines = append(lines, fmt.Sprintf("%s: %s", role, strings.TrimSpace(message.Content)))
	}
	return strings.Join(lines, "\n")
}

func appendToolMessage(messages []agent.Message, toolCallID, payload string) []agent.Message {
	content := normalizeJSONPayload(payload)
	return append(messages, agent.Message{
		Role:       "tool",
		ToolCallID: toolCallID,
		Content:    &content,
	})
}

func makeToolEvidence(runID, toolName, payload string) store.EvidenceItem {
	return store.EvidenceItem{
		ID:      generateID(),
		Source:  toolName,
		Title:   prettyToolLabel(toolName),
		Content: truncateText(strings.TrimSpace(payload), 2000),
		Metadata: map[string]interface{}{
			"runId": runID,
		},
	}
}

func parseArguments(raw string) map[string]interface{} {
	if strings.TrimSpace(raw) == "" {
		return map[string]interface{}{}
	}
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return map[string]interface{}{}
	}
	return args
}

func normalizeJSONPayload(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "{}"
	}
	if json.Valid([]byte(raw)) {
		return raw
	}
	return mustJSON(map[string]string{"text": raw})
}

func truncateText(text string, max int) string {
	text = strings.TrimSpace(text)
	if max <= 0 || len(text) <= max {
		return text
	}
	return strings.TrimSpace(text[:max]) + "..."
}

func stringArg(args map[string]interface{}, key, def string) string {
	val, ok := args[key]
	if !ok || val == nil {
		return def
	}
	switch v := val.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return def
		}
		return v
	default:
		return def
	}
}

func intArg(args map[string]interface{}, key string, def int) int {
	val, ok := args[key]
	if !ok || val == nil {
		return def
	}
	switch v := val.(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return def
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func prettyToolLabel(name string) string {
	name = strings.ReplaceAll(name, "_", " ")
	name = strings.ReplaceAll(name, "-", " ")
	name = strings.TrimSpace(name)
	if name == "" {
		return "Tool result"
	}
	parts := strings.Fields(name)
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func appendMissingCapability(missing []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return missing
	}
	for _, existing := range missing {
		if existing == value {
			return missing
		}
	}
	return append(missing, value)
}

func mustJSON(value interface{}) string {
	bytes, _ := json.Marshal(value)
	return string(bytes)
}
