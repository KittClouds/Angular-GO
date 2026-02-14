/**
 * Go Chat Service
 *
 * TypeScript wrapper for Go WASM chat operations.
 * Provides thread management, message persistence, and memory integration.
 *
 * Architecture:
 * - GoChatService: Persistence & memory extraction (Go WASM)
 * - OpenRouterService/GoogleGenAIService: Live LLM streaming (TypeScript)
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { GoKittService } from '../../services/gokitt.service';
import { getSetting, setSetting } from '../dexie/settings.service';
import { ScopeService } from './scope.service';

// =============================================================================
// TypeScript Interfaces (matching Go structs)
// =============================================================================

/** Chat thread - scoped to worldId + narrativeId */
export interface Thread {
    id: string;
    world_id: string;
    narrative_id: string;
    title: string;
    created_at: number;
    updated_at: number;
}

/** Message within a thread */
export interface ThreadMessage {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    narrative_id: string;
    created_at: number;
    updated_at: number;
    is_streaming: boolean;
}

/** Extracted memory from conversations */
export interface Memory {
    id: string;
    content: string;
    memory_type: 'fact' | 'preference' | 'entity_mention' | 'relation';
    confidence: number;
    source_role: string;
    entity_id: string;
    created_at: number;
    updated_at: number;
}

/** Configuration for chat initialization */
export interface ChatConfig {
    apiKey: string;
    model: string;
    // Observational Memory settings
    omEnabled?: boolean;
    observeThreshold?: number;
    reflectThreshold?: number;
}

/** Thread creation options */
export interface CreateThreadOptions {
    worldId?: string;
    narrativeId?: string;
}

// =============================================================================
// Service Implementation
// =============================================================================

@Injectable({ providedIn: 'root' })
export class GoChatService {
    private goKittService = inject(GoKittService);
    private scopeService = inject(ScopeService);

    // Reactive State
    readonly ready = signal(false);
    readonly initialized = signal(false);
    readonly currentThread = signal<Thread | null>(null);
    readonly messages = signal<ThreadMessage[]>([]);
    readonly threads = signal<Thread[]>([]);
    readonly loading = signal(false);

    // Computed
    readonly messageCount = computed(() => this.messages().length);
    readonly hasThread = computed(() => this.currentThread() !== null);

    constructor() {
        console.log('[GoChatService] Service created');
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    /**
     * Initialize the chat service with OpenRouter config.
     * Reads config from Dexie settings if not provided.
     */
    async init(config?: ChatConfig): Promise<void> {
        if (this.initialized()) {
            console.log('[GoChatService] Already initialized');
            return;
        }

        // Wait for GoKitt WASM to be ready
        if (!this.goKittService.isReady) {
            console.log('[GoChatService] Waiting for GoKitt WASM...');
            await new Promise<void>((resolve) => {
                this.goKittService.onReady(() => resolve());
            });
        }

        // Get config from Dexie if not provided
        if (!config) {
            const savedConfig = getSetting<ChatConfig | null>('openrouter:config', null);
            if (savedConfig) {
                config = savedConfig;
            }
        }

        if (!config?.apiKey) {
            console.warn('[GoChatService] No API key configured - chat will not persist memories');
            // Still mark as ready for basic operations
            this.ready.set(true);
            this.initialized.set(true);
            return;
        }

        try {
            // Initialize Go chat service via WASM
            // Include OM settings from GoOMService if available
            const configJSON = JSON.stringify({
                apiKey: config.apiKey,
                model: config.model || 'meta-llama/llama-3.3-70b-instruct:free',
                omEnabled: config.omEnabled ?? true,
                observeThreshold: config.observeThreshold ?? 1000,
                reflectThreshold: config.reflectThreshold ?? 4000
            });

            const result = await this.goKittService.chatInit(configJSON);

            if (result.error) {
                console.error('[GoChatService] Init failed:', result.error);
                return;
            }

            this.ready.set(true);
            this.initialized.set(true);
            console.log('[GoChatService] ✅ Chat service initialized');

            // Load existing threads
            await this.loadThreads();

            // Restore last active thread
            await this.restoreLastThread();

        } catch (err) {
            console.error('[GoChatService] Init error:', err);
        }
    }

    // =========================================================================
    // Thread Management
    // =========================================================================

    /**
     * Create a new chat thread.
     * Uses current scope if worldId/narrativeId not provided.
     */
    async createThread(options?: CreateThreadOptions): Promise<Thread | null> {
        const scope = this.scopeService.activeScope();

        // Use scope.id as worldId (folder/vault id) and narrativeId from scope
        const worldId = options?.worldId || scope.id || 'default';
        const narrativeId = options?.narrativeId || scope.narrativeId || 'default';

        try {
            const result = await this.goKittService.chatCreateThread(worldId, narrativeId);

            if (result.error) {
                console.error('[GoChatService] Create thread failed:', result.error);
                return null;
            }

            const thread = result as Thread;

            // Update state
            this.currentThread.set(thread);
            this.messages.set([]);
            this.threads.update(threads => [thread, ...threads]);

            // Save as active thread
            setSetting('chat:activeThreadId', thread.id);

            console.log('[GoChatService] Created thread:', thread.id);
            return thread;

        } catch (err) {
            console.error('[GoChatService] Create thread error:', err);
            return null;
        }
    }

    /**
     * Load a specific thread by ID.
     */
    async loadThread(threadId: string): Promise<void> {
        this.loading.set(true);

        try {
            // Get thread details
            const thread = await this.goKittService.chatGetThread(threadId);

            if (!thread || thread.error) {
                console.error('[GoChatService] Thread not found:', threadId);
                this.loading.set(false);
                return;
            }

            this.currentThread.set(thread as Thread);

            // Load messages
            await this.loadMessages(threadId);

            // Save as active thread
            setSetting('chat:activeThreadId', threadId);

            console.log('[GoChatService] Loaded thread:', threadId, 'with', this.messages().length, 'messages');

        } catch (err) {
            console.error('[GoChatService] Load thread error:', err);
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Load all threads for the current world.
     */
    async loadThreads(): Promise<void> {
        const scope = this.scopeService.activeScope();
        // Use scope.id as worldId (folder/vault id)
        const worldId = scope.id || '';

        try {
            const result = await this.goKittService.chatListThreads(worldId);

            // Handle null/undefined result (empty database or WASM not ready)
            if (!result) {
                this.threads.set([]);
                console.log('[GoChatService] No threads found (empty database)');
                return;
            }

            if (result.error) {
                console.error('[GoChatService] List threads failed:', result.error);
                return;
            }

            const threads = Array.isArray(result) ? result as Thread[] : [];
            this.threads.set(threads);

            console.log('[GoChatService] Loaded', threads.length, 'threads');

        } catch (err) {
            console.error('[GoChatService] Load threads error:', err);
        }
    }

    /**
     * Delete a thread and all its messages.
     */
    async deleteThread(threadId: string): Promise<boolean> {
        try {
            const result = await this.goKittService.chatDeleteThread(threadId);

            if (result.error) {
                console.error('[GoChatService] Delete thread failed:', result.error);
                return false;
            }

            // Update state
            this.threads.update(threads => threads.filter(t => t.id !== threadId));

            // If this was the current thread, clear it
            if (this.currentThread()?.id === threadId) {
                this.currentThread.set(null);
                this.messages.set([]);
            }

            console.log('[GoChatService] Deleted thread:', threadId);
            return true;

        } catch (err) {
            console.error('[GoChatService] Delete thread error:', err);
            return false;
        }
    }

    /**
     * Get or create a thread for the current scope.
     */
    async getOrCreateThread(): Promise<Thread | null> {
        if (this.currentThread()) {
            return this.currentThread();
        }

        // Try to restore last thread
        const lastThreadId = getSetting<string | null>('chat:activeThreadId', null);
        if (lastThreadId) {
            await this.loadThread(lastThreadId);
            if (this.currentThread()) {
                return this.currentThread();
            }
        }

        // Create new thread
        return this.createThread();
    }

    // =========================================================================
    // Message Operations
    // =========================================================================

    /**
     * Add a message to the current thread.
     * Creates a thread if none exists.
     */
    async addMessage(role: 'user' | 'assistant' | 'system', content: string): Promise<ThreadMessage | null> {
        // Ensure we have a thread
        const thread = await this.getOrCreateThread();
        if (!thread) {
            console.error('[GoChatService] Cannot add message - no thread');
            return null;
        }

        try {
            const result = await this.goKittService.chatAddMessage(
                thread.id,
                role,
                content,
                thread.narrative_id
            );

            if (result.error) {
                console.error('[GoChatService] Add message failed:', result.error);
                return null;
            }

            const message = result as ThreadMessage;

            // Update local state
            this.messages.update(msgs => [...msgs, message]);

            return message;

        } catch (err) {
            console.error('[GoChatService] Add message error:', err);
            return null;
        }
    }

    /**
     * Add a user message.
     */
    async addUserMessage(content: string): Promise<ThreadMessage | null> {
        return this.addMessage('user', content);
    }

    /**
     * Add an assistant message.
     */
    async addAssistantMessage(content: string): Promise<ThreadMessage | null> {
        return this.addMessage('assistant', content);
    }

    /**
     * Update message content (for editing).
     */
    async updateMessage(messageId: string, content: string): Promise<boolean> {
        try {
            const result = await this.goKittService.chatUpdateMessage(messageId, content);

            if (result.error) {
                console.error('[GoChatService] Update message failed:', result.error);
                return false;
            }

            // Update local state
            this.messages.update(msgs =>
                msgs.map(m => m.id === messageId ? { ...m, content, updated_at: Date.now() } : m)
            );

            return true;

        } catch (err) {
            console.error('[GoChatService] Update message error:', err);
            return false;
        }
    }

    /**
     * Append content to a message (for streaming).
     */
    async appendMessage(messageId: string, chunk: string): Promise<boolean> {
        try {
            const result = await this.goKittService.chatAppendMessage(messageId, chunk);

            if (result.error) {
                console.error('[GoChatService] Append message failed:', result.error);
                return false;
            }

            // Update local state
            this.messages.update(msgs =>
                msgs.map(m => m.id === messageId ? { ...m, content: m.content + chunk } : m)
            );

            return true;

        } catch (err) {
            console.error('[GoChatService] Append message error:', err);
            return false;
        }
    }

    /**
     * Start a streaming message (creates placeholder).
     */
    async startStreamingMessage(): Promise<ThreadMessage | null> {
        const thread = this.currentThread();
        if (!thread) {
            console.error('[GoChatService] Cannot start streaming - no thread');
            return null;
        }

        try {
            const result = await this.goKittService.chatStartStreaming(
                thread.id,
                thread.narrative_id
            );

            if (result.error) {
                console.error('[GoChatService] Start streaming failed:', result.error);
                return null;
            }

            const message = result as ThreadMessage;

            // Add to local state
            this.messages.update(msgs => [...msgs, message]);

            return message;

        } catch (err) {
            console.error('[GoChatService] Start streaming error:', err);
            return null;
        }
    }

    /**
     * Load messages for a thread.
     */
    private async loadMessages(threadId: string): Promise<void> {
        try {
            const result = await this.goKittService.chatGetMessages(threadId);

            if (result.error) {
                console.error('[GoChatService] Load messages failed:', result.error);
                this.messages.set([]);
                return;
            }

            const messages = Array.isArray(result) ? result as ThreadMessage[] : [];
            this.messages.set(messages);

        } catch (err) {
            console.error('[GoChatService] Load messages error:', err);
            this.messages.set([]);
        }
    }

    // =========================================================================
    // Memory Operations
    // =========================================================================

    /**
     * Get memories for the current thread.
     */
    async getMemories(): Promise<Memory[]> {
        const thread = this.currentThread();
        if (!thread) return [];

        try {
            const result = await this.goKittService.chatGetMemories(thread.id);

            if (result.error) {
                console.error('[GoChatService] Get memories failed:', result.error);
                return [];
            }

            return Array.isArray(result) ? result as Memory[] : [];

        } catch (err) {
            console.error('[GoChatService] Get memories error:', err);
            return [];
        }
    }

    /**
     * Get formatted context string for LLM prompts.
     * Includes relevant memories for RAG.
     */
    async getContext(): Promise<string> {
        const thread = this.currentThread();
        if (!thread) return '';

        try {
            const result = await this.goKittService.chatGetContext(thread.id);

            if (typeof result === 'string') {
                return result;
            }

            return '';

        } catch (err) {
            console.error('[GoChatService] Get context error:', err);
            return '';
        }
    }

    // =========================================================================
    // Utility Operations
    // =========================================================================

    /**
     * Clear messages in the current thread.
     */
    async clearThread(): Promise<boolean> {
        const thread = this.currentThread();
        if (!thread) return false;

        try {
            const result = await this.goKittService.chatClearThread(thread.id);

            if (result.error) {
                console.error('[GoChatService] Clear thread failed:', result.error);
                return false;
            }

            this.messages.set([]);
            return true;

        } catch (err) {
            console.error('[GoChatService] Clear thread error:', err);
            return false;
        }
    }

    /**
     * Export thread as JSON.
     */
    async exportThread(): Promise<string> {
        const thread = this.currentThread();
        if (!thread) return '{}';

        try {
            const result = await this.goKittService.chatExportThread(thread.id);

            if (typeof result === 'string') {
                return result;
            }

            return '{}';

        } catch (err) {
            console.error('[GoChatService] Export thread error:', err);
            return '{}';
        }
    }

    /**
     * Restore the last active thread from settings.
     * Clears the saved ID if the thread no longer exists.
     */
    private async restoreLastThread(): Promise<void> {
        const lastThreadId = getSetting<string | null>('chat:activeThreadId', null);
        if (lastThreadId) {
            await this.loadThread(lastThreadId);
            // If load failed (thread not found), clear the saved ID
            if (!this.currentThread()) {
                console.log('[GoChatService] Clearing stale thread ID from settings');
                setSetting('chat:activeThreadId', null);
            }
        }
    }

    /**
     * Start a new chat session (creates new thread).
     */
    async newSession(): Promise<Thread | null> {
        this.messages.set([]);
        return this.createThread();
    }
}
