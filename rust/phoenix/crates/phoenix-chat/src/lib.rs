use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};

use phoenix_om::{approx_token_count, OmEngine};
use phoenix_store_cozo::{PhoenixCozoStore, StoreError};
use phoenix_types::{
    CapabilityProfile, ChatRun, ChatRunEvent, ChatRunSnapshot, ChatRunStatus, ChatRuntimeConfig,
    Diagnostic, EvidenceItem, OmPendingAction, RunOptions, Thread, ThreadId, ThreadMessage,
    ToolResultSubmission,
};
use serde_json::{json, Value};

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Default)]
pub struct GatheredContributions {
    pub prepared_context: String,
    pub evidence: Vec<EvidenceItem>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Clone, Debug, Default)]
pub struct ContributorCoordinator;

impl ContributorCoordinator {
    pub fn gather(
        &self,
        _thread: &Thread,
        _messages: &[ThreadMessage],
        _options: &RunOptions,
    ) -> GatheredContributions {
        GatheredContributions::default()
    }
}

#[derive(Default)]
pub struct PhoenixChat {
    config: RefCell<ChatRuntimeConfig>,
    contributors: ContributorCoordinator,
    om_engine: OmEngine,
}

impl PhoenixChat {
    pub fn init_config(&self, config: ChatRuntimeConfig) -> ChatRuntimeConfig {
        *self.config.borrow_mut() = config.clone();
        config
    }

    pub fn current_config(&self) -> ChatRuntimeConfig {
        self.config.borrow().clone()
    }

    pub fn prepare_om(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
    ) -> Result<Option<OmPendingAction>, StoreError> {
        let config = OmEngine::config_from_runtime(&self.current_config());
        self.om_engine
            .prepare_pending_action(store, thread_id, &config)
            .map_err(|error| StoreError::Query(error.to_string()))
    }

    pub fn apply_om_action(
        &self,
        store: &PhoenixCozoStore,
        action: &OmPendingAction,
        response: &str,
    ) -> Result<bool, StoreError> {
        self.om_engine
            .apply_pending_action(store, action, response)
            .map_err(|error| StoreError::Query(error.to_string()))
    }

    pub fn create_thread(
        &self,
        store: &PhoenixCozoStore,
        world_id: Option<&str>,
        narrative_id: Option<&str>,
        title: Option<&str>,
    ) -> Result<Thread, StoreError> {
        let now = now_ms();
        let thread = Thread {
            id: ThreadId(generate_id("thread", now)),
            world_id: world_id.unwrap_or_default().to_owned(),
            narrative_id: narrative_id.unwrap_or_default().to_owned(),
            title: title.unwrap_or_default().to_owned(),
            created_at: now,
            updated_at: now,
        };
        self.persist_thread(store, &thread)?;
        Ok(thread)
    }

    pub fn get_thread(
        &self,
        store: &PhoenixCozoStore,
        id: &str,
    ) -> Result<Option<Thread>, StoreError> {
        Ok(store
            .fetch_rows("threads")?
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
            .map(thread_from_row)
            .transpose()?)
    }

    pub fn list_threads(
        &self,
        store: &PhoenixCozoStore,
        world_id: Option<&str>,
    ) -> Result<Vec<Thread>, StoreError> {
        let mut threads = store
            .fetch_rows("threads")?
            .into_iter()
            .filter(|row| {
                world_id.is_none()
                    || row
                        .get("world_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        == world_id.unwrap_or_default()
            })
            .map(thread_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        threads.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.0.cmp(&right.id.0))
        });
        Ok(threads)
    }

    pub fn delete_thread(&self, store: &PhoenixCozoStore, id: &str) -> Result<(), StoreError> {
        delete_rows_with_filter(store, "thread_messages", |row| {
            row.get("thread_id").and_then(Value::as_str) == Some(id)
        })?;
        let run_ids = store
            .fetch_rows("chat_runs")?
            .into_iter()
            .filter(|row| row.get("thread_id").and_then(Value::as_str) == Some(id))
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect::<Vec<_>>();
        for run_id in &run_ids {
            delete_rows_with_filter(store, "chat_run_events", |row| {
                row.get("run_id").and_then(Value::as_str) == Some(run_id.as_str())
            })?;
            delete_rows_with_filter(store, "chat_tool_calls", |row| {
                row.get("run_id").and_then(Value::as_str) == Some(run_id.as_str())
            })?;
            delete_rows_with_filter(store, "chat_approval_requests", |row| {
                row.get("run_id").and_then(Value::as_str) == Some(run_id.as_str())
            })?;
        }
        delete_rows_with_filter(store, "chat_runs", |row| {
            row.get("thread_id").and_then(Value::as_str) == Some(id)
        })?;
        delete_rows_with_filter(store, "threads", |row| {
            row.get("id").and_then(Value::as_str) == Some(id)
        })?;
        Ok(())
    }

    pub fn add_message(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        role: &str,
        content: &str,
        narrative_id: Option<&str>,
    ) -> Result<ThreadMessage, StoreError> {
        let now = now_ms();
        let message = ThreadMessage {
            id: generate_id("msg", now),
            thread_id: thread_id.to_owned(),
            role: role.to_owned(),
            content: content.to_owned(),
            narrative_id: narrative_id.unwrap_or_default().to_owned(),
            created_at: now,
            updated_at: now,
            is_streaming: false,
            token_count: Some(estimate_token_count(content)),
            is_observed: false,
        };
        self.persist_message(store, &message)?;
        self.touch_thread(store, thread_id, None, now)?;
        Ok(message)
    }

    pub fn list_messages(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
    ) -> Result<Vec<ThreadMessage>, StoreError> {
        let mut messages = store
            .fetch_rows("thread_messages")?
            .into_iter()
            .filter(|row| row.get("thread_id").and_then(Value::as_str) == Some(thread_id))
            .map(message_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        messages.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(messages)
    }

    pub fn update_message(
        &self,
        store: &PhoenixCozoStore,
        message_id: &str,
        content: &str,
    ) -> Result<Option<ThreadMessage>, StoreError> {
        let Some(mut message) = self.get_message(store, message_id)? else {
            return Ok(None);
        };
        message.content = content.to_owned();
        message.updated_at = now_ms();
        message.is_streaming = false;
        message.token_count = Some(estimate_token_count(content));
        message.is_observed = false;
        self.persist_message(store, &message)?;
        self.touch_thread(store, &message.thread_id, None, message.updated_at)?;
        Ok(Some(message))
    }

    pub fn append_message(
        &self,
        store: &PhoenixCozoStore,
        message_id: &str,
        chunk: &str,
    ) -> Result<Option<ThreadMessage>, StoreError> {
        let Some(mut message) = self.get_message(store, message_id)? else {
            return Ok(None);
        };
        message.content.push_str(chunk);
        message.updated_at = now_ms();
        message.is_streaming = true;
        message.token_count = Some(estimate_token_count(&message.content));
        message.is_observed = false;
        self.persist_message(store, &message)?;
        self.touch_thread(store, &message.thread_id, None, message.updated_at)?;
        Ok(Some(message))
    }

    pub fn start_streaming_message(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        narrative_id: Option<&str>,
    ) -> Result<ThreadMessage, StoreError> {
        let now = now_ms();
        let message = ThreadMessage {
            id: generate_id("msg", now),
            thread_id: thread_id.to_owned(),
            role: "assistant".to_owned(),
            content: String::new(),
            narrative_id: narrative_id.unwrap_or_default().to_owned(),
            created_at: now,
            updated_at: now,
            is_streaming: true,
            token_count: Some(0),
            is_observed: false,
        };
        self.persist_message(store, &message)?;
        self.touch_thread(store, thread_id, None, now)?;
        Ok(message)
    }

    pub fn clear_thread(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
    ) -> Result<(), StoreError> {
        delete_rows_with_filter(store, "thread_messages", |row| {
            row.get("thread_id").and_then(Value::as_str) == Some(thread_id)
        })?;
        self.touch_thread(store, thread_id, Some(""), now_ms())?;
        Ok(())
    }

    pub fn export_thread(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
    ) -> Result<String, StoreError> {
        let thread = self
            .get_thread(store, thread_id)?
            .ok_or_else(|| StoreError::Query(format!("thread not found: {thread_id}")))?;
        let messages = self.list_messages(store, thread_id)?;
        serde_json::to_string_pretty(&json!({
            "thread": thread,
            "messages": messages,
        }))
        .map_err(|error| StoreError::Query(error.to_string()))
    }

    pub fn start_run(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        prompt: &str,
        options: RunOptions,
    ) -> Result<ChatRun, StoreError> {
        let thread = self
            .get_thread(store, thread_id)?
            .ok_or_else(|| StoreError::Query(format!("thread not found: {thread_id}")))?;
        let now = now_ms();
        let deadline_at = now + options.deadline_ms.max(0);
        let capabilities = default_capabilities(&self.current_config());
        let mut run = ChatRun {
            id: generate_id("run", now),
            thread_id: thread.id.clone(),
            user_prompt: prompt.to_owned(),
            status: ChatRunStatus::Queued,
            options: options.clone(),
            capabilities,
            prepared_context: String::new(),
            prepared_system_prompt: String::new(),
            planner_messages_json: "[]".to_owned(),
            evidence_json: "[]".to_owned(),
            missing_capabilities_json: "[]".to_owned(),
            error: None,
            final_response: None,
            assistant_message_id: None,
            deadline_at,
            completed_at: None,
            created_at: now,
            updated_at: now,
        };
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", now),
                run_id: run.id.clone(),
                phase: "run".to_owned(),
                kind: "status".to_owned(),
                label: "Queued".to_owned(),
                detail: Some("Run created.".to_owned()),
                status: Some("running".to_owned()),
                payload: None,
                latency_ms: None,
                created_at: now,
            },
        )?;

        run.status = ChatRunStatus::Gathering;
        run.updated_at = now_ms();
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", run.updated_at),
                run_id: run.id.clone(),
                phase: "gather".to_owned(),
                kind: "status".to_owned(),
                label: "Gathering context".to_owned(),
                detail: Some("Preparing the main reply.".to_owned()),
                status: Some("running".to_owned()),
                payload: None,
                latency_ms: None,
                created_at: run.updated_at,
            },
        )?;

        let messages = self.list_messages(store, thread_id)?;
        let gathered = self.contributors.gather(&thread, &messages, &options);
        let mut evidence = gathered.evidence.clone();
        let om_context = if options.om_enabled && self.current_config().om_enabled {
            self.om_engine
                .build_context_block(store, thread_id)
                .map_err(|error| StoreError::Query(error.to_string()))?
        } else {
            None
        };
        if let Some(content) = om_context.as_deref() {
            evidence.push(EvidenceItem {
                id: generate_id("evidence", now_ms()),
                source: "om_context".to_owned(),
                title: Some("Observational memory".to_owned()),
                content: content.to_owned(),
                score: None,
                metadata: None,
            });
        }
        run.prepared_context = build_prepared_context(&options, &gathered);
        run.prepared_system_prompt =
            build_prepared_system_prompt(&options, &run.prepared_context, om_context.as_deref());
        run.evidence_json = serde_json::to_string(&evidence)
            .map_err(|error| StoreError::Query(error.to_string()))?;
        run.status = if gathered.diagnostics.is_empty() {
            ChatRunStatus::ReadyToAnswer
        } else {
            ChatRunStatus::Degraded
        };
        run.updated_at = now_ms();
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", run.updated_at),
                run_id: run.id.clone(),
                phase: "answer".to_owned(),
                kind: "status".to_owned(),
                label: "Ready to answer".to_owned(),
                detail: Some("Prepared the final reply prompt.".to_owned()),
                status: Some("done".to_owned()),
                payload: None,
                latency_ms: None,
                created_at: run.updated_at,
            },
        )?;
        Ok(run)
    }

    pub fn poll_run(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
    ) -> Result<Option<ChatRunSnapshot>, StoreError> {
        let Some(run) = self.get_run(store, run_id)? else {
            return Ok(None);
        };
        let events = self.list_run_events(store, run_id)?;
        let evidence = if run.evidence_json.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&run.evidence_json).unwrap_or_default()
        };
        let missing_capabilities = if run.missing_capabilities_json.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&run.missing_capabilities_json).unwrap_or_default()
        };
        Ok(Some(ChatRunSnapshot {
            run,
            events,
            tool_calls: Vec::new(),
            approvals: Vec::new(),
            evidence,
            missing_capabilities,
        }))
    }

    pub fn resume_run(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
    ) -> Result<Option<ChatRun>, StoreError> {
        let Some(run) = self.get_run(store, run_id)? else {
            return Ok(None);
        };
        Ok(Some(run))
    }

    pub fn mark_run_streaming(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
        assistant_message_id: &str,
    ) -> Result<Option<ChatRunSnapshot>, StoreError> {
        let Some(mut run) = self.get_run(store, run_id)? else {
            return Ok(None);
        };
        run.status = ChatRunStatus::Streaming;
        run.assistant_message_id = Some(assistant_message_id.to_owned());
        run.updated_at = now_ms();
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", run.updated_at),
                run_id: run.id.clone(),
                phase: "stream".to_owned(),
                kind: "stream".to_owned(),
                label: "Streaming answer".to_owned(),
                detail: Some("Streaming assistant tokens.".to_owned()),
                status: Some("running".to_owned()),
                payload: None,
                latency_ms: None,
                created_at: run.updated_at,
            },
        )?;
        self.poll_run(store, run_id)
    }

    pub fn complete_run(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
        assistant_message_id: &str,
        final_response: &str,
        final_error: Option<&str>,
    ) -> Result<Option<ChatRunSnapshot>, StoreError> {
        let Some(mut run) = self.get_run(store, run_id)? else {
            return Ok(None);
        };
        if let Some(mut assistant_message) = self.get_message(store, assistant_message_id)? {
            assistant_message.is_streaming = false;
            assistant_message.updated_at = now_ms();
            if !final_response.is_empty() && assistant_message.content != final_response {
                assistant_message.content = final_response.to_owned();
            }
            assistant_message.token_count = Some(estimate_token_count(&assistant_message.content));
            assistant_message.is_observed = false;
            self.persist_message(store, &assistant_message)?;
        }
        run.assistant_message_id = Some(assistant_message_id.to_owned());
        if let Some(error) = final_error {
            run.status = ChatRunStatus::Failed;
            run.error = Some(error.to_owned());
            run.final_response = if final_response.is_empty() {
                None
            } else {
                Some(final_response.to_owned())
            };
        } else {
            run.status = ChatRunStatus::Completed;
            run.error = None;
            run.final_response = Some(final_response.to_owned());
        }
        run.completed_at = Some(now_ms());
        run.updated_at = run.completed_at.unwrap_or(run.updated_at);
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", run.updated_at),
                run_id: run.id.clone(),
                phase: "stream".to_owned(),
                kind: "stream".to_owned(),
                label: if final_error.is_some() {
                    "Answer failed".to_owned()
                } else {
                    "Answer completed".to_owned()
                },
                detail: final_error
                    .map(str::to_owned)
                    .or_else(|| Some("Completed.".to_owned())),
                status: Some(if final_error.is_some() {
                    "error".to_owned()
                } else {
                    "done".to_owned()
                }),
                payload: None,
                latency_ms: None,
                created_at: run.updated_at,
            },
        )?;
        self.poll_run(store, run_id)
    }

    pub fn cancel_run(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
    ) -> Result<Option<ChatRun>, StoreError> {
        let Some(mut run) = self.get_run(store, run_id)? else {
            return Ok(None);
        };
        run.status = ChatRunStatus::Cancelled;
        run.completed_at = Some(now_ms());
        run.updated_at = run.completed_at.unwrap_or(run.updated_at);
        self.persist_run(store, &run)?;
        self.persist_event(
            store,
            &ChatRunEvent {
                id: generate_id("event", run.updated_at),
                run_id: run.id.clone(),
                phase: "run".to_owned(),
                kind: "status".to_owned(),
                label: "Cancelled".to_owned(),
                detail: Some("Run cancelled.".to_owned()),
                status: Some("error".to_owned()),
                payload: None,
                latency_ms: None,
                created_at: run.updated_at,
            },
        )?;
        Ok(Some(run))
    }

    pub fn list_run_events_for_thread(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        limit: usize,
    ) -> Result<Vec<ChatRunEvent>, StoreError> {
        let run_ids = store
            .fetch_rows("chat_runs")?
            .into_iter()
            .filter(|row| row.get("thread_id").and_then(Value::as_str) == Some(thread_id))
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect::<Vec<_>>();
        let mut events = store
            .fetch_rows("chat_run_events")?
            .into_iter()
            .filter(|row| {
                row.get("run_id")
                    .and_then(Value::as_str)
                    .map(|value| run_ids.iter().any(|run_id| run_id == value))
                    .unwrap_or(false)
            })
            .map(event_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        events.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        events.truncate(limit);
        Ok(events)
    }

    pub fn submit_tool_results(
        &self,
        _store: &PhoenixCozoStore,
        _run_id: &str,
        _results: &[ToolResultSubmission],
    ) -> Result<ChatRunSnapshot, StoreError> {
        Err(StoreError::Query(
            "main Phoenix agent does not support tool result submission".to_owned(),
        ))
    }

    pub fn submit_approval(
        &self,
        _store: &PhoenixCozoStore,
        _run_id: &str,
        _approval_id: &str,
        _approved: bool,
        _decision_json: Option<&str>,
    ) -> Result<ChatRunSnapshot, StoreError> {
        Err(StoreError::Query(
            "main Phoenix agent does not support approval submission".to_owned(),
        ))
    }

    fn touch_thread(
        &self,
        store: &PhoenixCozoStore,
        thread_id: &str,
        title_override: Option<&str>,
        updated_at: i64,
    ) -> Result<(), StoreError> {
        let Some(mut thread) = self.get_thread(store, thread_id)? else {
            return Ok(());
        };
        if let Some(title) = title_override {
            thread.title = title.to_owned();
        } else if thread.title.is_empty() {
            let preview = self
                .list_messages(store, thread_id)?
                .into_iter()
                .find(|message| message.role == "user")
                .map(|message| trim_preview(&message.content))
                .unwrap_or_default();
            thread.title = preview;
        }
        thread.updated_at = updated_at;
        self.persist_thread(store, &thread)
    }

    fn persist_thread(&self, store: &PhoenixCozoStore, thread: &Thread) -> Result<(), StoreError> {
        store.put_row(
            "threads",
            json!({
                "id": thread.id.0,
                "world_id": nullable_string(&thread.world_id),
                "narrative_id": nullable_string(&thread.narrative_id),
                "title": nullable_string(&thread.title),
                "created_at": thread.created_at,
                "updated_at": thread.updated_at,
            }),
        )
    }

    fn persist_message(
        &self,
        store: &PhoenixCozoStore,
        message: &ThreadMessage,
    ) -> Result<(), StoreError> {
        store.put_row(
            "thread_messages",
            json!({
                "id": message.id,
                "thread_id": message.thread_id,
                "role": message.role,
                "content": message.content,
                "narrative_id": nullable_string(&message.narrative_id),
                "created_at": message.created_at,
                "updated_at": message.updated_at,
                "is_streaming": message.is_streaming,
                "token_count": message.token_count,
                "is_observed": message.is_observed,
            }),
        )
    }

    fn persist_run(&self, store: &PhoenixCozoStore, run: &ChatRun) -> Result<(), StoreError> {
        store.put_row(
            "chat_runs",
            json!({
                "id": run.id,
                "thread_id": run.thread_id.0,
                "user_prompt": run.user_prompt,
                "status": run.status.as_str(),
                "options_json": serde_json::to_value(&run.options).map_err(|error| StoreError::Query(error.to_string()))?,
                "capabilities_json": serde_json::to_value(&run.capabilities).map_err(|error| StoreError::Query(error.to_string()))?,
                "prepared_context": run.prepared_context,
                "prepared_system_prompt": run.prepared_system_prompt,
                "planner_messages_json": json_string_or_value(&run.planner_messages_json),
                "evidence_json": json_string_or_value(&run.evidence_json),
                "missing_capabilities_json": json_string_or_value(&run.missing_capabilities_json),
                "error": run.error,
                "final_response": run.final_response,
                "assistant_message_id": run.assistant_message_id,
                "deadline_at": run.deadline_at,
                "completed_at": run.completed_at,
                "created_at": run.created_at,
                "updated_at": run.updated_at,
            }),
        )
    }

    fn persist_event(
        &self,
        store: &PhoenixCozoStore,
        event: &ChatRunEvent,
    ) -> Result<(), StoreError> {
        store.put_row(
            "chat_run_events",
            json!({
                "id": event.id,
                "run_id": event.run_id,
                "phase": event.phase,
                "kind": event.kind,
                "label": event.label,
                "detail": event.detail,
                "status": event.status,
                "payload": event.payload,
                "latency_ms": event.latency_ms,
                "created_at": event.created_at,
            }),
        )
    }

    fn get_message(
        &self,
        store: &PhoenixCozoStore,
        message_id: &str,
    ) -> Result<Option<ThreadMessage>, StoreError> {
        Ok(store
            .fetch_rows("thread_messages")?
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(message_id))
            .map(message_from_row)
            .transpose()?)
    }

    fn get_run(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
    ) -> Result<Option<ChatRun>, StoreError> {
        Ok(store
            .fetch_rows("chat_runs")?
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(run_id))
            .map(run_from_row)
            .transpose()?)
    }

    fn list_run_events(
        &self,
        store: &PhoenixCozoStore,
        run_id: &str,
    ) -> Result<Vec<ChatRunEvent>, StoreError> {
        let mut events = store
            .fetch_rows("chat_run_events")?
            .into_iter()
            .filter(|row| row.get("run_id").and_then(Value::as_str) == Some(run_id))
            .map(event_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        events.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(events)
    }
}

fn delete_rows_with_filter(
    store: &PhoenixCozoStore,
    relation: &str,
    predicate: impl Fn(&Value) -> bool,
) -> Result<(), StoreError> {
    let rows = store.fetch_rows(relation)?;
    let compact = store.fetch_compact_rows(relation)?;
    let matched = rows
        .iter()
        .zip(compact)
        .filter_map(|(row, compact)| predicate(row).then_some(compact))
        .collect::<Vec<_>>();
    store.delete_key_rows(relation, &matched)
}

fn nullable_string(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

fn json_string_or_value(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or_else(|_| Value::String(value.to_owned()))
}

fn default_capabilities(config: &ChatRuntimeConfig) -> CapabilityProfile {
    CapabilityProfile {
        om_enabled: config.om_enabled,
        workspace_enabled: false,
        planner_enabled: false,
        go_tool_host: false,
        ts_tool_host: false,
        block_search: false,
    }
}

fn build_prepared_context(options: &RunOptions, gathered: &GatheredContributions) -> String {
    let mut parts = Vec::new();
    if let Some(context) = options.initial_external_context.as_deref() {
        let trimmed = context.trim();
        if !trimmed.is_empty() {
            parts.push(trimmed.to_owned());
        }
    }
    let gathered_context = gathered.prepared_context.trim();
    if !gathered_context.is_empty() {
        parts.push(gathered_context.to_owned());
    }
    parts.join("\n\n")
}

fn build_prepared_system_prompt(
    options: &RunOptions,
    prepared_context: &str,
    om_context: Option<&str>,
) -> String {
    let mut sections = Vec::new();
    let base = options.base_system_prompt.as_deref().unwrap_or("").trim();
    let context = prepared_context.trim();
    let om_context = om_context.unwrap_or("").trim();

    if !om_context.is_empty() {
        sections.push(format!(
            "Use this observational memory while answering:\n\n{om_context}"
        ));
    }
    if !base.is_empty() {
        sections.push(base.to_owned());
    }
    if !context.is_empty() {
        sections.push(format!("Use this context while answering:\n\n{context}"));
    }

    sections.join("\n\n")
}

fn estimate_token_count(text: &str) -> i64 {
    approx_token_count(text)
}

fn trim_preview(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let max_chars = 80;
    if normalized.chars().count() <= max_chars {
        normalized
    } else {
        normalized.chars().take(max_chars).collect::<String>() + "..."
    }
}

fn generate_id(prefix: &str, now: i64) -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{now}-{counter}")
}

fn now_ms() -> i64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as i64
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_millis() as i64
    }
}

fn thread_from_row(row: Value) -> Result<Thread, StoreError> {
    let object = row.as_object().ok_or(StoreError::InvalidRow)?;
    Ok(Thread {
        id: ThreadId(string_field(object, "id")),
        world_id: string_opt_field(object, "world_id").unwrap_or_default(),
        narrative_id: string_opt_field(object, "narrative_id").unwrap_or_default(),
        title: string_opt_field(object, "title").unwrap_or_default(),
        created_at: int_field(object, "created_at"),
        updated_at: int_field(object, "updated_at"),
    })
}

fn message_from_row(row: Value) -> Result<ThreadMessage, StoreError> {
    let object = row.as_object().ok_or(StoreError::InvalidRow)?;
    Ok(ThreadMessage {
        id: string_field(object, "id"),
        thread_id: string_field(object, "thread_id"),
        role: string_field(object, "role"),
        content: string_field(object, "content"),
        narrative_id: string_opt_field(object, "narrative_id").unwrap_or_default(),
        created_at: int_field(object, "created_at"),
        updated_at: int_field(object, "updated_at"),
        is_streaming: bool_field(object, "is_streaming"),
        token_count: object.get("token_count").and_then(Value::as_i64),
        is_observed: bool_field(object, "is_observed"),
    })
}

fn run_from_row(row: Value) -> Result<ChatRun, StoreError> {
    let object = row.as_object().ok_or(StoreError::InvalidRow)?;
    Ok(ChatRun {
        id: string_field(object, "id"),
        thread_id: ThreadId(string_field(object, "thread_id")),
        user_prompt: string_field(object, "user_prompt"),
        status: ChatRunStatus::from_str(&string_field(object, "status")),
        options: serde_json::from_value(object.get("options_json").cloned().unwrap_or(Value::Null))
            .map_err(|error| StoreError::Query(error.to_string()))?,
        capabilities: serde_json::from_value(
            object
                .get("capabilities_json")
                .cloned()
                .unwrap_or(Value::Null),
        )
        .map_err(|error| StoreError::Query(error.to_string()))?,
        prepared_context: string_field(object, "prepared_context"),
        prepared_system_prompt: string_field(object, "prepared_system_prompt"),
        planner_messages_json: json_column_to_string(object.get("planner_messages_json")),
        evidence_json: json_column_to_string(object.get("evidence_json")),
        missing_capabilities_json: json_column_to_string(object.get("missing_capabilities_json")),
        error: string_opt_field(object, "error"),
        final_response: string_opt_field(object, "final_response"),
        assistant_message_id: string_opt_field(object, "assistant_message_id"),
        deadline_at: int_field(object, "deadline_at"),
        completed_at: object.get("completed_at").and_then(Value::as_i64),
        created_at: int_field(object, "created_at"),
        updated_at: int_field(object, "updated_at"),
    })
}

fn event_from_row(row: Value) -> Result<ChatRunEvent, StoreError> {
    let object = row.as_object().ok_or(StoreError::InvalidRow)?;
    Ok(ChatRunEvent {
        id: string_field(object, "id"),
        run_id: string_field(object, "run_id"),
        phase: string_field(object, "phase"),
        kind: string_field(object, "kind"),
        label: string_field(object, "label"),
        detail: string_opt_field(object, "detail"),
        status: string_opt_field(object, "status"),
        payload: string_opt_field(object, "payload"),
        latency_ms: object.get("latency_ms").and_then(Value::as_i64),
        created_at: int_field(object, "created_at"),
    })
}

fn string_field(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn string_opt_field(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

fn int_field(object: &serde_json::Map<String, Value>, key: &str) -> i64 {
    object.get(key).and_then(Value::as_i64).unwrap_or_default()
}

fn bool_field(object: &serde_json::Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn json_column_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.clone(),
        Some(other) => serde_json::to_string(other).unwrap_or_else(|_| "[]".to_owned()),
        None => "[]".to_owned(),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub mod provider {
    use anyhow::Result;
    use openrouter_rs::{api::chat::ChatCompletionRequest, OpenRouterClient};

    use crate::default_capabilities;

    #[derive(Debug)]
    pub struct NativeOpenRouterProvider {
        client: OpenRouterClient,
    }

    impl NativeOpenRouterProvider {
        pub fn new(api_key: &str, referer: &str, title: &str) -> Result<Self> {
            let client = OpenRouterClient::builder()
                .api_key(api_key)
                .http_referer(referer)
                .x_title(title)
                .build()?;
            Ok(Self { client })
        }

        pub async fn send(&self, request: &ChatCompletionRequest) -> Result<String> {
            let response = self.client.send_chat_completion(request).await?;
            Ok(response
                .choices
                .first()
                .and_then(|choice| choice.content())
                .unwrap_or("")
                .to_owned())
        }

        pub fn default_capabilities_profile() -> phoenix_types::CapabilityProfile {
            default_capabilities(&phoenix_types::ChatRuntimeConfig::default())
        }
    }
}

#[cfg(test)]
mod tests {
    use phoenix_store_cozo::{PhoenixCozoStore, StoreConfig};
    use phoenix_types::{ChatRunStatus, RunOptions, StorageMode};

    use super::PhoenixChat;

    fn store() -> PhoenixCozoStore {
        let store = PhoenixCozoStore::open(StoreConfig {
            mode: StorageMode::CozoMem,
            path: None,
        })
        .expect("open store");
        store.init_schema().expect("init schema");
        store
    }

    #[test]
    fn thread_and_message_round_trip() {
        let chat = PhoenixChat::default();
        let store = store();
        let thread = chat
            .create_thread(&store, Some("world-1"), Some("narrative-1"), Some("Thread"))
            .expect("thread");
        let message = chat
            .add_message(
                &store,
                &thread.id.0,
                "user",
                "Hello there",
                Some("narrative-1"),
            )
            .expect("message");
        let messages = chat.list_messages(&store, &thread.id.0).expect("messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, message.id);
        assert_eq!(messages[0].content, "Hello there");
    }

    #[test]
    fn run_lifecycle_reaches_ready_then_completed() {
        let chat = PhoenixChat::default();
        let store = store();
        let thread = chat
            .create_thread(&store, Some("world-1"), Some("narrative-1"), Some("Thread"))
            .expect("thread");
        chat.add_message(
            &store,
            &thread.id.0,
            "user",
            "Who are you?",
            Some("narrative-1"),
        )
        .expect("message");
        let run = chat
            .start_run(
                &store,
                &thread.id.0,
                "Who are you?",
                RunOptions {
                    final_provider: "openrouter".to_owned(),
                    final_model: "google/gemini-2.5-flash".to_owned(),
                    deadline_ms: 8_000,
                    mutation_policy: "confirm".to_owned(),
                    ..RunOptions::default()
                },
            )
            .expect("run");
        assert!(matches!(
            run.status,
            ChatRunStatus::ReadyToAnswer | ChatRunStatus::Degraded
        ));

        let assistant = chat
            .start_streaming_message(&store, &thread.id.0, Some("narrative-1"))
            .expect("assistant");
        let snapshot = chat
            .mark_run_streaming(&store, &run.id, &assistant.id)
            .expect("snapshot")
            .expect("run snapshot");
        assert!(matches!(snapshot.run.status, ChatRunStatus::Streaming));

        let completed = chat
            .complete_run(&store, &run.id, &assistant.id, "I am Kammi.", None)
            .expect("completed")
            .expect("completed snapshot");
        assert!(matches!(completed.run.status, ChatRunStatus::Completed));
        assert_eq!(completed.tool_calls.len(), 0);
        assert_eq!(completed.approvals.len(), 0);
    }
}
