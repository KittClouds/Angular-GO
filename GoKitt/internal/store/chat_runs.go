package store

import (
	"database/sql"
	"encoding/json"
)

func (s *SQLiteStore) UpsertChatRun(run *ChatRun) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	optionsJSON, _ := json.Marshal(run.Options)
	capabilitiesJSON, _ := json.Marshal(run.Capabilities)

	_, err := s.db.Exec(`
		INSERT INTO chat_runs (
			id, thread_id, user_prompt, status, options_json, capabilities_json,
			prepared_context, prepared_system_prompt, planner_messages_json, evidence_json,
			missing_capabilities_json, error, final_response, assistant_message_id,
			deadline_at, completed_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			thread_id = excluded.thread_id,
			user_prompt = excluded.user_prompt,
			status = excluded.status,
			options_json = excluded.options_json,
			capabilities_json = excluded.capabilities_json,
			prepared_context = excluded.prepared_context,
			prepared_system_prompt = excluded.prepared_system_prompt,
			planner_messages_json = excluded.planner_messages_json,
			evidence_json = excluded.evidence_json,
			missing_capabilities_json = excluded.missing_capabilities_json,
			error = excluded.error,
			final_response = excluded.final_response,
			assistant_message_id = excluded.assistant_message_id,
			deadline_at = excluded.deadline_at,
			completed_at = excluded.completed_at,
			updated_at = excluded.updated_at
	`, run.ID, run.ThreadID, run.UserPrompt, string(run.Status), string(optionsJSON), string(capabilitiesJSON),
		run.PreparedContext, run.PreparedSystemPrompt, run.PlannerMessagesJSON, run.EvidenceJSON,
		run.MissingCapabilities, run.Error, run.FinalResponse, run.AssistantMessageID,
		run.DeadlineAt, run.CompletedAt, run.CreatedAt, run.UpdatedAt)
	return err
}

func (s *SQLiteStore) GetChatRun(id string) (*ChatRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, thread_id, user_prompt, status, options_json, capabilities_json,
		       prepared_context, prepared_system_prompt, planner_messages_json, evidence_json,
		       missing_capabilities_json, error, final_response, assistant_message_id,
		       deadline_at, completed_at, created_at, updated_at
		FROM chat_runs WHERE id = ?
	`, id)

	var run ChatRun
	var optionsJSON, capabilitiesJSON string
	if err := row.Scan(
		&run.ID, &run.ThreadID, &run.UserPrompt, &run.Status, &optionsJSON, &capabilitiesJSON,
		&run.PreparedContext, &run.PreparedSystemPrompt, &run.PlannerMessagesJSON, &run.EvidenceJSON,
		&run.MissingCapabilities, &run.Error, &run.FinalResponse, &run.AssistantMessageID,
		&run.DeadlineAt, &run.CompletedAt, &run.CreatedAt, &run.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	_ = json.Unmarshal([]byte(optionsJSON), &run.Options)
	_ = json.Unmarshal([]byte(capabilitiesJSON), &run.Capabilities)
	return &run, nil
}

func (s *SQLiteStore) ListChatRuns(threadID string, limit int) ([]*ChatRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}

	rows, err := s.db.Query(`
		SELECT id, thread_id, user_prompt, status, options_json, capabilities_json,
		       prepared_context, prepared_system_prompt, planner_messages_json, evidence_json,
		       missing_capabilities_json, error, final_response, assistant_message_id,
		       deadline_at, completed_at, created_at, updated_at
		FROM chat_runs
		WHERE (? = '' OR thread_id = ?)
		ORDER BY created_at DESC
		LIMIT ?
	`, threadID, threadID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	runs := make([]*ChatRun, 0)
	for rows.Next() {
		var run ChatRun
		var optionsJSON, capabilitiesJSON string
		if err := rows.Scan(
			&run.ID, &run.ThreadID, &run.UserPrompt, &run.Status, &optionsJSON, &capabilitiesJSON,
			&run.PreparedContext, &run.PreparedSystemPrompt, &run.PlannerMessagesJSON, &run.EvidenceJSON,
			&run.MissingCapabilities, &run.Error, &run.FinalResponse, &run.AssistantMessageID,
			&run.DeadlineAt, &run.CompletedAt, &run.CreatedAt, &run.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(optionsJSON), &run.Options)
		_ = json.Unmarshal([]byte(capabilitiesJSON), &run.Capabilities)
		runs = append(runs, &run)
	}
	return runs, rows.Err()
}

func (s *SQLiteStore) AddChatRunEvent(event *ChatRunEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO chat_run_events (
			id, run_id, phase, kind, label, detail, status, payload, latency_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.RunID, event.Phase, event.Kind, event.Label, event.Detail, event.Status, event.Payload, event.LatencyMs, event.CreatedAt)
	return err
}

func (s *SQLiteStore) ListChatRunEvents(runID string, limit int) ([]*ChatRunEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 100
	}

	rows, err := s.db.Query(`
		SELECT id, run_id, phase, kind, label, detail, status, payload, latency_ms, created_at
		FROM chat_run_events
		WHERE run_id = ?
		ORDER BY created_at ASC
		LIMIT ?
	`, runID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]*ChatRunEvent, 0)
	for rows.Next() {
		var event ChatRunEvent
		if err := rows.Scan(
			&event.ID, &event.RunID, &event.Phase, &event.Kind, &event.Label, &event.Detail,
			&event.Status, &event.Payload, &event.LatencyMs, &event.CreatedAt,
		); err != nil {
			return nil, err
		}
		events = append(events, &event)
	}
	return events, rows.Err()
}

func (s *SQLiteStore) UpsertChatToolCall(call *ChatToolCall) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO chat_tool_calls (
			id, run_id, tool_call_id, tool_name, host, class, status, arguments_json, result_json,
			error, idempotency_key, approval_id, started_at, completed_at, latency_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			run_id = excluded.run_id,
			tool_call_id = excluded.tool_call_id,
			tool_name = excluded.tool_name,
			host = excluded.host,
			class = excluded.class,
			status = excluded.status,
			arguments_json = excluded.arguments_json,
			result_json = excluded.result_json,
			error = excluded.error,
			idempotency_key = excluded.idempotency_key,
			approval_id = excluded.approval_id,
			started_at = excluded.started_at,
			completed_at = excluded.completed_at,
			latency_ms = excluded.latency_ms
	`, call.ID, call.RunID, call.ToolCallID, call.ToolName, string(call.Host), string(call.Class), call.Status,
		call.ArgumentsJSON, call.ResultJSON, call.Error, call.IdempotencyKey, call.ApprovalID,
		call.StartedAt, call.CompletedAt, call.LatencyMs)
	return err
}

func (s *SQLiteStore) GetChatToolCall(id string) (*ChatToolCall, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, run_id, tool_call_id, tool_name, host, class, status, arguments_json, result_json,
		       error, idempotency_key, approval_id, started_at, completed_at, latency_ms
		FROM chat_tool_calls WHERE id = ?
	`, id)

	var call ChatToolCall
	if err := row.Scan(
		&call.ID, &call.RunID, &call.ToolCallID, &call.ToolName, &call.Host, &call.Class, &call.Status,
		&call.ArgumentsJSON, &call.ResultJSON, &call.Error, &call.IdempotencyKey, &call.ApprovalID,
		&call.StartedAt, &call.CompletedAt, &call.LatencyMs,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &call, nil
}

func (s *SQLiteStore) ListChatToolCalls(runID string) ([]*ChatToolCall, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, run_id, tool_call_id, tool_name, host, class, status, arguments_json, result_json,
		       error, idempotency_key, approval_id, started_at, completed_at, latency_ms
		FROM chat_tool_calls
		WHERE run_id = ?
		ORDER BY started_at ASC, id ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	calls := make([]*ChatToolCall, 0)
	for rows.Next() {
		var call ChatToolCall
		if err := rows.Scan(
			&call.ID, &call.RunID, &call.ToolCallID, &call.ToolName, &call.Host, &call.Class, &call.Status,
			&call.ArgumentsJSON, &call.ResultJSON, &call.Error, &call.IdempotencyKey, &call.ApprovalID,
			&call.StartedAt, &call.CompletedAt, &call.LatencyMs,
		); err != nil {
			return nil, err
		}
		calls = append(calls, &call)
	}
	return calls, rows.Err()
}

func (s *SQLiteStore) FindChatToolCall(runID, toolCallID string) (*ChatToolCall, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, run_id, tool_call_id, tool_name, host, class, status, arguments_json, result_json,
		       error, idempotency_key, approval_id, started_at, completed_at, latency_ms
		FROM chat_tool_calls
		WHERE run_id = ? AND tool_call_id = ?
		LIMIT 1
	`, runID, toolCallID)

	var call ChatToolCall
	if err := row.Scan(
		&call.ID, &call.RunID, &call.ToolCallID, &call.ToolName, &call.Host, &call.Class, &call.Status,
		&call.ArgumentsJSON, &call.ResultJSON, &call.Error, &call.IdempotencyKey, &call.ApprovalID,
		&call.StartedAt, &call.CompletedAt, &call.LatencyMs,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &call, nil
}

func (s *SQLiteStore) UpsertChatApproval(req *ChatApprovalRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO chat_approval_requests (
			id, run_id, tool_call_id, tool_name, status, affected_note_id, summary, diff_preview,
			expected_revision, rollback_token, proposal_json, decision_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			run_id = excluded.run_id,
			tool_call_id = excluded.tool_call_id,
			tool_name = excluded.tool_name,
			status = excluded.status,
			affected_note_id = excluded.affected_note_id,
			summary = excluded.summary,
			diff_preview = excluded.diff_preview,
			expected_revision = excluded.expected_revision,
			rollback_token = excluded.rollback_token,
			proposal_json = excluded.proposal_json,
			decision_json = excluded.decision_json,
			updated_at = excluded.updated_at
	`, req.ID, req.RunID, req.ToolCallID, req.ToolName, req.Status, req.AffectedNoteID, req.Summary,
		req.DiffPreview, req.ExpectedRevision, req.RollbackToken, req.ProposalJSON, req.DecisionJSON,
		req.CreatedAt, req.UpdatedAt)
	return err
}

func (s *SQLiteStore) GetChatApproval(id string) (*ChatApprovalRequest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	row := s.db.QueryRow(`
		SELECT id, run_id, tool_call_id, tool_name, status, affected_note_id, summary, diff_preview,
		       expected_revision, rollback_token, proposal_json, decision_json, created_at, updated_at
		FROM chat_approval_requests WHERE id = ?
	`, id)

	var req ChatApprovalRequest
	if err := row.Scan(
		&req.ID, &req.RunID, &req.ToolCallID, &req.ToolName, &req.Status, &req.AffectedNoteID,
		&req.Summary, &req.DiffPreview, &req.ExpectedRevision, &req.RollbackToken, &req.ProposalJSON,
		&req.DecisionJSON, &req.CreatedAt, &req.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &req, nil
}

func (s *SQLiteStore) ListChatApprovals(runID string) ([]*ChatApprovalRequest, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, run_id, tool_call_id, tool_name, status, affected_note_id, summary, diff_preview,
		       expected_revision, rollback_token, proposal_json, decision_json, created_at, updated_at
		FROM chat_approval_requests
		WHERE run_id = ?
		ORDER BY created_at ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	approvals := make([]*ChatApprovalRequest, 0)
	for rows.Next() {
		var req ChatApprovalRequest
		if err := rows.Scan(
			&req.ID, &req.RunID, &req.ToolCallID, &req.ToolName, &req.Status, &req.AffectedNoteID,
			&req.Summary, &req.DiffPreview, &req.ExpectedRevision, &req.RollbackToken, &req.ProposalJSON,
			&req.DecisionJSON, &req.CreatedAt, &req.UpdatedAt,
		); err != nil {
			return nil, err
		}
		approvals = append(approvals, &req)
	}
	return approvals, rows.Err()
}
