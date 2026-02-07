/**
 * AI Chat Service
 * 
 * Manages AI chat history with Nebula + Cozo persistence.
 * Provides session management and message CRUD operations.
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { nebulaDb } from '../../lib/nebula/db';
import { cozoDb } from '../../lib/cozo/db';
import { ChatMessage } from '../../lib/cozo/schema/layer4-memory';
import { ScopeService } from '../../lib/services/scope.service';

// Session identifier generator
function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

@Injectable({ providedIn: 'root' })
export class AiChatService {
    private scopeService = inject(ScopeService);

    // Current session ID
    private _sessionId = signal<string>(this.loadOrCreateSession());

    // All messages in current session
    private _messages = signal<ChatMessage[]>([]);

    // Loading state
    private _loading = signal(false);

    // Public accessors
    readonly sessionId = this._sessionId.asReadonly();
    readonly messages = this._messages.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly messageCount = computed(() => this._messages().length);

    constructor() {
        // Delay load to allow CozoDB to initialize
        setTimeout(() => this.loadSessionMessages(), 500);
    }

    // -------------------------------------------------------------------------
    // Session Management
    // -------------------------------------------------------------------------

    private loadOrCreateSession(): string {
        const saved = localStorage.getItem('ai-chat:sessionId');
        if (saved) return saved;
        const newId = generateSessionId();
        localStorage.setItem('ai-chat:sessionId', newId);
        return newId;
    }

    /** Start a new chat session */
    newSession(): void {
        const newId = generateSessionId();
        this._sessionId.set(newId);
        this._messages.set([]);
        localStorage.setItem('ai-chat:sessionId', newId);
    }

    // -------------------------------------------------------------------------
    // Message CRUD
    // -------------------------------------------------------------------------

    /** Add a message to the current session */
    async addMessage(role: ChatMessage['role'], content: string): Promise<ChatMessage> {
        const scope = this.scopeService.activeScope();
        const message: ChatMessage = {
            id: crypto.randomUUID(),
            sessionId: this._sessionId(),
            role,
            content,
            createdAt: Date.now(),
            narrativeId: scope.narrativeId || '',
        };

        // Add to local state immediately
        this._messages.update(msgs => [...msgs, message]);

        // Persist to Nebula
        await nebulaDb.chatMessages.insert(message);

        // Persist to Cozo (fire-and-forget)
        this.persistToCozo(message);

        return message;
    }

    /** Add a user message */
    async addUserMessage(content: string): Promise<ChatMessage> {
        return this.addMessage('user', content);
    }

    /** Add an assistant message */
    async addAssistantMessage(content: string): Promise<ChatMessage> {
        return this.addMessage('assistant', content);
    }

    /** Update message content (for streaming) */
    updateMessageContent(messageId: string, content: string): void {
        this._messages.update(msgs =>
            msgs.map(m => m.id === messageId ? { ...m, content } : m)
        );
    }

    /** Append content to a message (for streaming) */
    appendMessageContent(messageId: string, chunk: string): void {
        this._messages.update(msgs =>
            msgs.map(m => m.id === messageId ? { ...m, content: m.content + chunk } : m)
        );
    }

    // -------------------------------------------------------------------------
    // Persistence
    // -------------------------------------------------------------------------

    private persistToCozo(message: ChatMessage): void {
        try {
            const query = `
                ?[id, session_id, role, content, created_at, narrative_id, metadata] <- [[
                    $id, $session_id, $role, $content, $created_at, $narrative_id, $metadata
                ]]
                :put chat_messages {
                    id => session_id, role, content, created_at, narrative_id, metadata
                }
            `;
            cozoDb.run(query, {
                id: message.id,
                session_id: message.sessionId,
                role: message.role,
                content: message.content,
                created_at: message.createdAt,
                narrative_id: message.narrativeId || '',
                metadata: message.metadata || {},
            });
        } catch (err) {
            console.error('[AiChatService] Cozo persist failed:', err);
        }
    }

    /** Load messages for current session */
    async loadSessionMessages(): Promise<void> {
        this._loading.set(true);
        try {
            const sessionId = this._sessionId();

            // Try Nebula first (in-memory, fast)
            const nebulaMsgs = await nebulaDb.chatMessages.find({ sessionId }) as ChatMessage[];

            if (nebulaMsgs.length > 0) {
                // Sort by createdAt
                nebulaMsgs.sort((a, b) => a.createdAt - b.createdAt);
                this._messages.set(nebulaMsgs);
            } else {
                // Fallback to Cozo
                const cozoMsgs = this.loadFromCozo(sessionId);
                this._messages.set(cozoMsgs);

                // Hydrate Nebula
                for (const msg of cozoMsgs) {
                    await nebulaDb.chatMessages.insert(msg);
                }
            }
        } catch (err) {
            console.error('[AiChatService] Load failed:', err);
            this._messages.set([]);
        } finally {
            this._loading.set(false);
        }
    }

    private loadFromCozo(sessionId: string): ChatMessage[] {
        try {
            // Check if CozoDB is initialized
            if (!cozoDb.isReady()) {
                console.log('[AiChatService] CozoDB not yet initialized, skipping load');
                return [];
            }

            const query = `
                ?[id, session_id, role, content, created_at, narrative_id, metadata] :=
                    *chat_messages{id, session_id, role, content, created_at, narrative_id, metadata},
                    session_id == $session_id
                :order created_at
            `;
            const resultStr = cozoDb.run(query, { session_id: sessionId });
            const result = JSON.parse(resultStr);

            if (result.ok === false || !result.rows) {
                return [];
            }

            return result.rows.map((row: unknown[]) => ({
                id: row[0] as string,
                sessionId: row[1] as string,
                role: row[2] as ChatMessage['role'],
                content: row[3] as string,
                createdAt: row[4] as number,
                narrativeId: row[5] as string,
                metadata: row[6] as Record<string, unknown>,
            }));
        } catch (err) {
            console.error('[AiChatService] Cozo load failed:', err);
            return [];
        }
    }

    /** Clear current session messages */
    async clearSession(): Promise<void> {
        const sessionId = this._sessionId();

        // Clear Nebula
        await nebulaDb.chatMessages.delete({ sessionId });

        // Clear Cozo
        try {
            const query = `
                ?[id] := *chat_messages{id, session_id}, session_id == $session_id
                :rm chat_messages { id }
            `;
            cozoDb.run(query, { session_id: sessionId });
        } catch (err) {
            console.error('[AiChatService] Cozo clear failed:', err);
        }

        this._messages.set([]);
    }

    /** Get all sessions (for history browser) */
    getAllSessions(): string[] {
        try {
            const query = `
                ?[session_id, count(id), min(created_at)] :=
                    *chat_messages{session_id, id, created_at}
                :order -min(created_at)
                :limit 20
            `;
            const resultStr = cozoDb.run(query);
            const result = JSON.parse(resultStr);

            if (result.ok === false || !result.rows) {
                return [this._sessionId()];
            }

            return result.rows.map((row: unknown[]) => row[0] as string);
        } catch {
            return [this._sessionId()];
        }
    }

    /** Switch to a different session */
    async switchSession(sessionId: string): Promise<void> {
        this._sessionId.set(sessionId);
        localStorage.setItem('ai-chat:sessionId', sessionId);
        await this.loadSessionMessages();
    }

    /** Export chat history as JSON */
    exportHistory(): string {
        return JSON.stringify(this._messages(), null, 2);
    }
}
