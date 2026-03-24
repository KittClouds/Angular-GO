import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { getSetting, setSetting } from '../dexie/settings.service';
import {
    PhoenixChatService,
    type ChatConfig,
    type ChatProgressEvent,
    type OpenRouterMessage,
    type Thread,
} from './phoenix-chat.service';
import { GoogleGenAIService, type GoogleGenAIMessage } from './google-genai.service';
import { ChatContextClipStore } from '../store/chat-context-clip.store';

export interface SessionInfo {
    id: string;
    messageCount: number;
    createdAt: number;
    preview?: string;
}

export interface ActivityTraceStep {
    id: string;
    kind: 'reasoning' | 'tool' | 'stream' | 'status';
    label: string;
    detail?: string;
    status: 'running' | 'done' | 'error';
    latencyMs?: number;
}

export interface DisplayMessage {
    id: string;
    content: string;
    role: 'user' | 'assistant' | 'system';
    timestamp: Date;
    isStreaming?: boolean;
    activitySteps?: ActivityTraceStep[];
    statusText?: string;
}

interface TraceEntry {
    insertIndex: number;
    message: DisplayMessage;
}

interface StreamingDraft {
    insertIndex: number;
    traceId: string | null;
    message: DisplayMessage;
}

export const KAMMI_SYSTEM_PROMPT = `You are Kammi, a spunky and helpful AI assistant for KittClouds, a world-building and narrative design application.

Your personality:
- High-energy, enthusiastic about creative writing and world-building
- Precise and TDD-minded when discussing technical matters
- Encouraging and collaborative with users' creative ideas
- You use occasional emojis but don't overdo it

Your capabilities:
- Help users develop characters, plots, relationships, and world lore
- Assist with narrative structure and story arcs
- Provide feedback on world-building consistency
- Answer questions about the application's features

Keep responses concise but helpful. If you don't know something specific about the user's world, ask clarifying questions.`;

@Injectable({ providedIn: 'root' })
export class KammiChatUiService {
    readonly goChatService = inject(PhoenixChatService);
    readonly googleGenAI = inject(GoogleGenAIService);

    private readonly chatContextClipStore = inject(ChatContextClipStore);

    readonly activeProvider = signal<'google' | 'go-openrouter'>('go-openrouter');
    readonly apiKeyInput = signal('');
    readonly selectedModel = signal('nvidia/nemotron-3-nano-30b-a3b:free');
    readonly temperatureInput = signal(0.7);
    readonly maxTokensInput = signal(2048);
    readonly reasoningEnabledInput = signal(true);
    readonly reasoningEffortInput = signal<'low' | 'medium' | 'high'>('medium');
    readonly reasoningMaxTokensInput = signal(1024);
    readonly omEnabledInput = signal(true);
    readonly omModelInput = signal('nvidia/nemotron-3-super-120b-a12b:free');
    readonly observeThresholdInput = signal(1000);
    readonly reflectThresholdInput = signal(4000);
    readonly googleApiKeyInput = signal('');
    readonly googleModelInput = signal('gemini-3-flash-preview');
    readonly systemPromptInput = signal(KAMMI_SYSTEM_PROMPT);
    readonly indexEnabled = signal(false);
    readonly savedModels = signal<string[]>([]);
    readonly customModelInput = signal('');
    readonly isStreaming = signal(false);

    readonly suggestions = [
        'Help me develop a character backstory',
        'Create a magic system for my world',
        'Outline a three-act story structure',
        'Describe a fantasy city in detail',
    ];

    readonly isGoConfigured = computed(() => !!this.apiKeyInput().trim());
    readonly messageCount = computed(() => this.goChatService.messageCount());
    readonly sessions = computed<SessionInfo[]>(() =>
        this.goChatService.threads().map((thread: Thread) => ({
            id: thread.id,
            messageCount: 0,
            createdAt: thread.created_at,
            preview: thread.title || undefined,
        }))
    );

    readonly displayMessages = computed<DisplayMessage[]>(() => {
        const storedMessages: DisplayMessage[] = this.goChatService.messages().map((message) => ({
            id: message.id || this.generateId(),
            content: message.content,
            role: message.role as 'user' | 'assistant' | 'system',
            timestamp: new Date(message.created_at || Date.now()),
            isStreaming: !!message.is_streaming,
        }));

        const merged = [...storedMessages];
        const traceEntries = [...this.traceEntries()].sort((left, right) => left.insertIndex - right.insertIndex);
        const draft = this.streamingDraft();
        let offset = 0;

        for (const traceEntry of traceEntries) {
            const tracePosition = this.clampInsertIndex(traceEntry.insertIndex + offset, merged.length);
            merged.splice(tracePosition, 0, traceEntry.message);
            offset += 1;

            if (draft && draft.traceId === traceEntry.message.id) {
                const draftPosition = this.clampInsertIndex(tracePosition + 1, merged.length);
                merged.splice(draftPosition, 0, draft.message);
                offset += 1;
            }
        }

        if (draft && (!draft.traceId || !traceEntries.some((entry) => entry.message.id === draft.traceId))) {
            const draftPosition = this.clampInsertIndex(draft.insertIndex + offset, merged.length);
            merged.splice(draftPosition, 0, draft.message);
        }

        return merged;
    });

    private readonly MODELS_KEY = 'openrouter:models';
    private readonly MODEL_SEEDS = [
        'nvidia/nemotron-3-nano-30b-a3b:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-3-flash-preview',
        'deepseek/deepseek-r1:free',
        'mistralai/mistral-nemo:free',
        'z-ai/glm-4.5-air:free',
        'stepfun/step-3.5-flash:free',
        'arcee-ai/trinity-large-preview:free',
    ];

    private readonly traceEntries = signal<TraceEntry[]>([]);
    private readonly activitySteps = signal<ActivityTraceStep[]>([]);
    private readonly streamingDraft = signal<StreamingDraft | null>(null);

    private initialized = false;
    private lastThreadId: string | null = null;
    private currentTraceMessageId: string | null = null;
    private traceCounter = 0;
    private readonly traceStartedAt = new Map<string, number>();

    constructor() {
        this.savedModels.set(this.loadSavedModels());

        effect(() => {
            const threadId = this.goChatService.currentThread()?.id ?? null;
            if (threadId === this.lastThreadId) {
                return;
            }

            this.lastThreadId = threadId;
            this.resetTransientState();
        });
    }

    async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.loadSettings();
        await this.goChatService.init();
        this.initialized = true;
    }

    async saveSettings(): Promise<void> {
        this.ensureSelectedModelIsSaved();

        const existingConfig = getSetting<ChatConfig | null>('openrouter:config', null);
        const openRouterConfig: ChatConfig = {
            apiKey: this.apiKeyInput().trim(),
            model: this.selectedModel(),
            temperature: this.temperatureInput(),
            maxTokens: this.maxTokensInput(),
            reasoningEnabled: this.reasoningEnabledInput(),
            reasoningEffort: this.reasoningEffortInput(),
            reasoningMaxTokens: this.reasoningMaxTokensInput(),
            includeReasoning: this.reasoningEnabledInput(),
            structuredOutput: existingConfig?.structuredOutput,
            plugins: existingConfig?.plugins,
            omEnabled: this.omEnabledInput(),
            omModel: this.omModelInput(),
            observeThreshold: this.observeThresholdInput(),
            reflectThreshold: this.reflectThresholdInput(),
        };

        setSetting('openrouter:config', openRouterConfig);
        await this.goChatService.updateConfig(openRouterConfig);

        const googleApiKey = this.googleApiKeyInput().trim();
        if (googleApiKey) {
            this.googleGenAI.saveConfig({
                apiKey: googleApiKey,
                model: this.googleModelInput(),
                temperature: 0.7,
                maxOutputTokens: 2048,
                systemPrompt: this.systemPromptInput(),
            });
        } else if (this.googleGenAI.isConfigured()) {
            this.googleGenAI.clearConfig();
        }

        setSetting('chat:systemPrompt', this.systemPromptInput());
    }

    toggleIndexMode(): void {
        this.indexEnabled.update((enabled) => !enabled);
        setSetting('chat:indexMode', this.indexEnabled());
    }

    resetSystemPrompt(): void {
        this.systemPromptInput.set(KAMMI_SYSTEM_PROMPT);
    }

    addCustomModel(): void {
        const modelId = this.customModelInput().trim();
        if (!modelId) {
            return;
        }

        if (!this.savedModels().includes(modelId)) {
            const nextModels = [modelId, ...this.savedModels()];
            this.savedModels.set(nextModels);
            setSetting(this.MODELS_KEY, nextModels);
        }

        this.selectedModel.set(modelId);
        this.customModelInput.set('');
    }

    removeModel(modelId: string): void {
        const nextModels = this.savedModels().filter((savedModel) => savedModel !== modelId);
        this.savedModels.set(nextModels);
        setSetting(this.MODELS_KEY, nextModels);

        if (this.selectedModel() === modelId) {
            this.selectedModel.set(nextModels[0] ?? '');
        }
    }

    async selectSession(sessionId: string): Promise<void> {
        await this.goChatService.loadThread(sessionId);
    }

    async newSession(): Promise<void> {
        this.resetTransientState();
        await this.goChatService.newSession();
    }

    async clearChat(): Promise<void> {
        this.resetTransientState();
        await this.goChatService.clearThread();
    }

    async exportCurrentThread(): Promise<{ threadId: string; json: string }> {
        const json = await this.goChatService.exportThread();
        const threadId = this.goChatService.currentThread()?.id || 'unknown';
        return { threadId, json };
    }

    async sendMessage(rawText: string): Promise<void> {
        const text = rawText.trim();
        if (!text || this.isStreaming()) {
            return;
        }

        await this.init();

        this.streamingDraft.set(null);
        this.isStreaming.set(true);

        const userMessage = await this.goChatService.addUserMessage(text);
        if (!userMessage) {
            this.isStreaming.set(false);
            return;
        }

        const traceId = this.startActivityTrace(this.goChatService.messages().length);
        const googleConfigured = this.googleGenAI.isConfigured();
        const openRouterConfigured = this.isGoConfigured();

        if (!googleConfigured && !openRouterConfigured) {
            this.finishActivityStep(traceId, 'error', 'AI provider is not configured.');
            this.streamingDraft.set({
                insertIndex: this.goChatService.messages().length + 1,
                traceId: this.currentTraceMessageId,
                message: {
                    id: this.generateId(),
                    content: '[Warning] Please configure an API key in settings to enable responses.',
                    role: 'assistant',
                    timestamp: new Date(),
                },
            });
            this.isStreaming.set(false);
            return;
        }

        const highlightedClips = this.chatContextClipStore.consumeAll();
        const highlightedContext = this.chatContextClipStore.formatForPrompt(highlightedClips);
        if (highlightedClips.length > 0) {
            this.addCompletedStep('tool', 'Using highlighted text', 'Injected highlighted note snippets.');
        }

        const history = this.buildConversationHistory();
        const effectiveSystemPrompt = this.systemPromptInput()
            + (highlightedContext ? '\n\n' + highlightedContext : '');

        const reasoningStepId = this.activeProvider() === 'go-openrouter' && this.reasoningEnabledInput()
            ? this.addActivityStep('reasoning', 'Reasoning', 'Waiting for model reasoning...')
            : null;

        const thinkingSummary = this.buildThinkingSummary(highlightedClips.length);
        this.finishActivityStep(traceId, 'done', thinkingSummary);

        const streamingMessage = await this.goChatService.startStreamingMessage();
        if (!streamingMessage) {
            this.finishActivityStep(traceId, 'error', 'Failed to start assistant response.');
            this.isStreaming.set(false);
            return;
        }

        const streamStepId = this.addActivityStep('stream', 'Responding', 'Writing the answer...');
        await this.handleStreamingChat(
            streamingMessage.id,
            history,
            effectiveSystemPrompt,
            (event) => this.applyProgressEvent(streamStepId, event),
            reasoningStepId ? (chunk) => this.appendActivityStepDetail(reasoningStepId, chunk) : undefined
        );

        if (reasoningStepId) {
            this.finalizeReasoningStep(reasoningStepId);
        }

        if (this.isStreaming()) {
            this.finishActivityStep(streamStepId, 'done', 'Done');
            this.isStreaming.set(false);
        }
    }

    getActiveProviderName(): string {
        if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
            return `Google Gemini (${this.googleGenAI.getModel()})`;
        }

        const model = this.selectedModel();
        return model ? `Phoenix OpenRouter (${model.split('/').pop()})` : 'Phoenix OpenRouter';
    }

    stripSuggestionPrefix(text: string): string {
        return text.replace(/^[^\s]+\s/, '');
    }

    formatSessionDate(timestamp: number): string {
        const date = new Date(timestamp);
        const diff = Date.now() - date.getTime();
        if (diff < 86400000) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (diff < 604800000) {
            return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    formatTime(date: Date): string {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    private loadSettings(): void {
        const savedConfig = getSetting<ChatConfig | null>('openrouter:config', null);
        if (savedConfig) {
            this.apiKeyInput.set(savedConfig.apiKey || '');

            const restoredModel = savedConfig.model || 'nvidia/nemotron-3-nano-30b-a3b:free';
            this.selectedModel.set(restoredModel);
            if (!this.savedModels().includes(restoredModel)) {
                const nextModels = [restoredModel, ...this.savedModels()];
                this.savedModels.set(nextModels);
                setSetting(this.MODELS_KEY, nextModels);
            }

            this.temperatureInput.set(savedConfig.temperature ?? 0.7);
            this.maxTokensInput.set(savedConfig.maxTokens ?? 2048);
            this.reasoningEnabledInput.set(savedConfig.reasoningEnabled ?? true);
            this.reasoningEffortInput.set(savedConfig.reasoningEffort ?? 'medium');
            this.reasoningMaxTokensInput.set(savedConfig.reasoningMaxTokens ?? 1024);
            this.omEnabledInput.set(savedConfig.omEnabled ?? true);
            this.omModelInput.set(savedConfig.omModel || 'nvidia/nemotron-3-super-120b-a12b:free');
            this.observeThresholdInput.set(savedConfig.observeThreshold ?? 1000);
            this.reflectThresholdInput.set(savedConfig.reflectThreshold ?? 4000);
        }

        const googleConfig = this.googleGenAI.config();
        if (googleConfig) {
            this.googleApiKeyInput.set(googleConfig.apiKey || '');
            this.googleModelInput.set(googleConfig.model || 'gemini-2.0-flash');
        }

        if (this.googleGenAI.isConfigured() && !savedConfig?.apiKey) {
            this.activeProvider.set('google');
        }

        const savedPrompt = getSetting<string | null>('chat:systemPrompt', null);
        if (savedPrompt) {
            this.systemPromptInput.set(savedPrompt);
        }

        this.indexEnabled.set(getSetting<boolean>('chat:indexMode', false));
    }

    private loadSavedModels(): string[] {
        const stored = getSetting<string[] | null>(this.MODELS_KEY, null);
        if (stored && stored.length > 0) {
            return stored;
        }

        setSetting(this.MODELS_KEY, this.MODEL_SEEDS);
        return [...this.MODEL_SEEDS];
    }

    private ensureSelectedModelIsSaved(): void {
        const selectedModel = this.selectedModel().trim();
        if (!selectedModel || this.savedModels().includes(selectedModel)) {
            return;
        }

        const nextModels = [selectedModel, ...this.savedModels()];
        this.savedModels.set(nextModels);
        setSetting(this.MODELS_KEY, nextModels);
    }

    private buildConversationHistory(): OpenRouterMessage[] {
        return this.goChatService.messages()
            .slice(-10)
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }));
    }

    private startActivityTrace(insertIndex: number): string {
        this.traceCounter = 0;
        this.traceStartedAt.clear();
        this.activitySteps.set([]);

        const traceMessageId = this.generateId();
        this.currentTraceMessageId = traceMessageId;
        this.traceEntries.update((entries) => [
            ...entries,
            {
                insertIndex,
                message: {
                    id: traceMessageId,
                    content: '',
                    role: 'system',
                    timestamp: new Date(),
                    activitySteps: [],
                    statusText: 'Starting',
                },
            },
        ]);

        return this.addActivityStep(
            'reasoning',
            'Thinking',
            this.reasoningEnabledInput() && this.activeProvider() === 'go-openrouter'
                ? 'Reasoning through your request...'
                : 'Reading your request...'
        );
    }

    private addActivityStep(kind: ActivityTraceStep['kind'], label: string, detail?: string): string {
        const id = `step-${++this.traceCounter}`;
        this.traceStartedAt.set(id, Date.now());
        this.activitySteps.update((steps) => [...steps, { id, kind, label, detail, status: 'running' }]);
        this.syncActivityTrace();
        return id;
    }

    private addCompletedStep(
        kind: ActivityTraceStep['kind'],
        label: string,
        detail?: string,
        status: 'done' | 'error' = 'done',
        latencyMs?: number
    ): void {
        const id = `step-${++this.traceCounter}`;
        this.activitySteps.update((steps) => [...steps, { id, kind, label, detail, status, latencyMs }]);
        this.syncActivityTrace();
    }

    private finishActivityStep(
        stepId: string,
        status: ActivityTraceStep['status'],
        detail?: string,
        latencyMs?: number
    ): void {
        const startedAt = this.traceStartedAt.get(stepId);
        const measuredLatency = latencyMs ?? (startedAt ? Date.now() - startedAt : undefined);
        this.traceStartedAt.delete(stepId);

        this.activitySteps.update((steps) =>
            steps.map((step) => {
                if (step.id !== stepId) {
                    return step;
                }

                return {
                    ...step,
                    status,
                    detail: detail ?? step.detail,
                    latencyMs: measuredLatency,
                };
            })
        );
        this.syncActivityTrace();
    }

    private appendActivityStepDetail(stepId: string, chunk: string): void {
        this.activitySteps.update((steps) =>
            steps.map((step) => {
                if (step.id !== stepId) {
                    return step;
                }

                const nextDetail = step.detail === 'Waiting for model reasoning...'
                    ? chunk
                    : `${step.detail || ''}${chunk}`;

                return {
                    ...step,
                    detail: nextDetail,
                };
            })
        );
        this.syncActivityTrace();
    }

    private finalizeReasoningStep(stepId: string): void {
        const step = this.activitySteps().find((entry) => entry.id === stepId);
        if (!step) {
            return;
        }

        const detail = step.detail === 'Waiting for model reasoning...'
            ? 'Reasoning was enabled, but the model did not return reasoning tokens.'
            : step.detail;

        this.finishActivityStep(stepId, 'done', detail);
    }

    private applyProgressEvent(stepId: string, event: ChatProgressEvent): void {
        if (event.status === 'running') {
            this.activitySteps.update((steps) =>
                steps.map((step) => {
                    if (step.id !== stepId) {
                        return step;
                    }

                    return {
                        ...step,
                        detail: event.detail ?? step.detail,
                    };
                })
            );
            this.syncActivityTrace();
            return;
        }

        this.finishActivityStep(stepId, event.status, event.detail);
    }

    private syncActivityTrace(): void {
        if (!this.currentTraceMessageId) {
            return;
        }

        const currentSteps = [...this.activitySteps()];
        const statusText = this.getActivityStatusText();
        this.traceEntries.update((entries) =>
            entries.map((entry) => {
                if (entry.message.id !== this.currentTraceMessageId) {
                    return entry;
                }

                return {
                    ...entry,
                    message: {
                        ...entry.message,
                        activitySteps: currentSteps,
                        statusText,
                    },
                };
            })
        );
    }

    private getActivityStatusText(): string {
        const steps = this.activitySteps();
        if (steps.length === 0) {
            return 'Starting';
        }

        for (let index = steps.length - 1; index >= 0; index -= 1) {
            if (steps[index].status === 'running') {
                return steps[index].label;
            }
        }

        return steps.some((step) => step.status === 'error') ? 'Completed with issues' : 'Done';
    }

    private buildThinkingSummary(highlightedCount: number): string {
        const parts: string[] = [];

        if (highlightedCount > 0) {
            parts.push(highlightedCount === 1 ? 'included highlighted text' : `included ${highlightedCount} highlighted passages`);
        }

        if (parts.length === 0) {
            return 'Ready to answer.';
        }

        const sentence = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        return parts.length === 1 ? `${sentence}.` : `${sentence} and ${parts.slice(1).join(' and ')}.`;
    }

    private async handleStreamingChat(
        messageId: string,
        history: OpenRouterMessage[],
        systemPrompt: string,
        onProgress: (event: ChatProgressEvent) => void,
        onReasoning?: (chunk: string) => void
    ): Promise<void> {
        try {
            if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
                const googleHistory: GoogleGenAIMessage[] = history
                    .filter((message) => message.role !== 'system')
                    .map((message) => ({
                        role: message.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: message.content || '' }],
                    }));

                await this.googleGenAI.streamChat(
                    googleHistory,
                    {
                        onChunk: (chunk) => {
                            onProgress({ stage: 'stream', status: 'running' });
                            void this.goChatService.appendMessage(messageId, chunk);
                        },
                        onComplete: async (response) => {
                            onProgress({ stage: 'stream', status: 'done', detail: 'Completed successfully.' });
                            await this.goChatService.updateMessage(messageId, response);
                            this.isStreaming.set(false);
                        },
                        onError: (error) => {
                            onProgress({ stage: 'stream', status: 'error', detail: error.message });
                            void this.setStreamingError(messageId, `Error: ${error.message}`);
                        },
                    },
                    systemPrompt
                );
                return;
            }

            await this.goChatService.streamChat(
                history,
                {
                    onChunk: (chunk) => {
                        void this.goChatService.appendMessage(messageId, chunk);
                    },
                    onComplete: async (response) => {
                        await this.goChatService.updateMessage(messageId, response);
                        this.isStreaming.set(false);
                    },
                    onError: (error) => {
                        void this.setStreamingError(messageId, `Error: ${error.message}`);
                    },
                    onEvent: onProgress,
                    onReasoningChunk: onReasoning,
                },
                systemPrompt
            );
        } catch (error) {
            const message = this.toErrorMessage(error);
            onProgress({ stage: 'stream', status: 'error', detail: message });
            await this.setStreamingError(messageId, `System Error: ${message}`);
        }
    }

    private async setStreamingError(messageId: string, content: string): Promise<void> {
        await this.goChatService.updateMessage(messageId, content);
        this.isStreaming.set(false);
    }

    private resetTransientState(): void {
        this.traceEntries.set([]);
        this.activitySteps.set([]);
        this.streamingDraft.set(null);
        this.traceCounter = 0;
        this.traceStartedAt.clear();
        this.currentTraceMessageId = null;
        this.isStreaming.set(false);
    }

    private clampInsertIndex(index: number, length: number): number {
        return Math.max(0, Math.min(index, length));
    }

    private toErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 11);
    }
}
