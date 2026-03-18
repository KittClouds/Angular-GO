/**
 * AI Chat Page Component
 *
 * Full-feature chat page that sits between sidebars (like Graph/Calendar pages).
 * Uses @neurodevworks/angular-chatbot types + our existing GoChatService/GoogleGenAIService.
 */

import {
    Component,
    signal,
    computed,
    inject,
    OnInit,
    OnDestroy,
    AfterViewInit,
    ViewChild,
    ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
    LucideAngularModule,
    ArrowLeft,
    Plus,
    Trash2,
    Download,
    Settings,
    Send,
    History,
    Database,
    Brain,
    RotateCcw,
    Bot,
    User,
    Sparkles,
    MessageCircle,
    X,
} from 'lucide-angular';
import { getSetting, setSetting } from '../../lib/dexie/settings.service';
import {
    GoChatService,
    type Thread,
    type ChatConfig,
    type ChatProgressEvent,
    type OpenRouterMessage,
} from '../../lib/services/go-chat.service';
import { OrchestratorService } from '../../services/orchestrator.service';
import {
    GoogleGenAIService,
    GoogleGenAIMessage,
} from '../../lib/services/google-genai.service';
import { ChatContextClipStore } from '../../lib/store/chat-context-clip.store';
import type { ActivationResult } from '../../lib/rlm';

// Re-export types from the installed package for compatibility
import type { ChatMessage, ChatOptions, ChatConfig as PkgChatConfig } from '@neurodevworks/angular-chatbot';

interface SessionInfo {
    id: string;
    messageCount: number;
    createdAt: number;
    preview?: string;
}

interface DisplayMessage {
    id: string;
    content: string;
    role: 'user' | 'assistant' | 'system';
    timestamp: Date;
    isStreaming?: boolean;
}

const KAMMI_SYSTEM_PROMPT = `You are Kammi, a spunky and helpful AI assistant for KittClouds, a world-building and narrative design application.

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

@Component({
    selector: 'app-ai-chat-page',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    template: `
        <div class="h-full flex flex-col chat-page-bg">
            <!-- Top Toolbar -->
            <div class="flex items-center gap-4 px-4 py-2 border-b border-white/10 bg-[#12121a] shrink-0">
                <button
                    (click)="navigateToEditor()"
                    class="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
                    <lucide-icon [img]="ArrowLeft" size="16"></lucide-icon>
                    Back to Editor
                </button>

                <div class="flex-1 text-center">
                    <h1 class="text-lg font-semibold text-white/90 flex items-center justify-center gap-2">
                        <lucide-icon [img]="BotIcon" size="20" class="text-teal-400"></lucide-icon>
                        Kammi AI Chat
                    </h1>
                    <p class="text-xs text-slate-500">{{ getActiveProviderName() }}</p>
                </div>

                <div class="flex items-center gap-1">
                    <button
                        (click)="newSession()"
                        class="p-2 rounded-md text-slate-400 hover:text-teal-400 hover:bg-teal-500/10 transition-colors"
                        title="New Chat">
                        <lucide-icon [img]="PlusIcon" size="16"></lucide-icon>
                    </button>
                    <button
                        (click)="toggleHistory()"
                        class="p-2 rounded-md transition-colors"
                        [class.text-teal-400]="showHistory()"
                        [class.bg-teal-500/10]="showHistory()"
                        [class.text-slate-400]="!showHistory()"
                        [class.hover:text-white]="!showHistory()"
                        [class.hover:bg-white/10]="!showHistory()"
                        title="Chat History">
                        <lucide-icon [img]="HistoryIcon" size="16"></lucide-icon>
                    </button>
                    <button
                        (click)="exportChat()"
                        class="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Export Chat">
                        <lucide-icon [img]="DownloadIcon" size="16"></lucide-icon>
                    </button>
                    <button
                        (click)="clearChat()"
                        class="p-2 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Clear Chat">
                        <lucide-icon [img]="Trash2Icon" size="16"></lucide-icon>
                    </button>
                    <div class="w-px h-5 bg-white/10 mx-1"></div>
                    <button
                        (click)="toggleSettings()"
                        class="p-2 rounded-md transition-colors"
                        [class.bg-teal-500/20]="showSettings()"
                        [class.text-teal-400]="showSettings()"
                        [class.text-slate-400]="!showSettings()"
                        [class.hover:text-white]="!showSettings()"
                        [class.hover:bg-white/10]="!showSettings()"
                        title="Settings">
                        <lucide-icon [img]="SettingsIcon" size="16"></lucide-icon>
                    </button>
                </div>
            </div>

            <!-- Main Content -->
            <div class="flex-1 flex overflow-hidden relative">
                <!-- History Panel (left overlay) -->
                @if (showHistory()) {
                    <div class="w-72 border-r border-white/10 bg-[#12121a] overflow-y-auto shrink-0 flex flex-col">
                        <div class="p-3 border-b border-white/10 flex items-center justify-between">
                            <span class="text-sm font-semibold text-white">Threads</span>
                            <button class="p-1 rounded text-slate-400 hover:text-white" (click)="showHistory.set(false)">
                                <lucide-icon [img]="XIcon" size="14"></lucide-icon>
                            </button>
                        </div>
                        <div class="flex-1 overflow-y-auto p-2 space-y-1.5">
                            @for (session of sessions(); track session.id) {
                                <button
                                    class="w-full p-3 text-left rounded-lg border transition-all text-sm"
                                    [class.border-teal-500]="session.id === goChatService.currentThread()?.id"
                                    [class.bg-teal-500/10]="session.id === goChatService.currentThread()?.id"
                                    [class.border-white/5]="session.id !== goChatService.currentThread()?.id"
                                    [class.hover:bg-white/5]="session.id !== goChatService.currentThread()?.id"
                                    (click)="selectSession(session.id)">
                                    <div class="flex items-center justify-between">
                                        <span class="text-xs font-medium text-white truncate">{{ session.id }}</span>
                                        <span class="text-[10px] text-slate-500">{{ session.messageCount }} msgs</span>
                                    </div>
                                    <div class="text-[10px] text-slate-500 mt-1">{{ formatSessionDate(session.createdAt) }}</div>
                                    @if (session.preview) {
                                        <div class="text-xs text-slate-500 mt-1 truncate italic">"{{ session.preview }}"</div>
                                    }
                                </button>
                            } @empty {
                                <div class="text-center py-12 text-slate-500">
                                    <lucide-icon [img]="HistoryIcon" size="32" class="mx-auto opacity-30 mb-2"></lucide-icon>
                                    <p class="text-xs">No chat history yet</p>
                                </div>
                            }
                        </div>
                    </div>
                }

                <!-- Chat Area -->
                <div class="flex-1 flex flex-col min-w-0">
                    <!-- Messages -->
                    <div #messagesContainer class="flex-1 overflow-y-auto px-4 py-6 space-y-6 custom-scrollbar">
                        @if (displayMessages().length === 0) {
                            <div class="flex flex-col items-center justify-center h-full text-center">
                                <div class="w-20 h-20 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-6 border border-teal-500/20">
                                    <lucide-icon [img]="SparklesIcon" size="36" class="text-teal-400"></lucide-icon>
                                </div>
                                <h2 class="text-xl font-semibold text-white mb-2">Kammi AI</h2>
                                <p class="text-sm text-slate-400 max-w-md">
                                    Your creative world-building assistant. Ask about characters, lore, story structure, or anything else!
                                </p>
                                <div class="grid grid-cols-2 gap-2 mt-6 max-w-lg">
                                    @for (suggestion of suggestions; track suggestion) {
                                        <button
                                            class="p-3 text-left text-xs rounded-lg border border-white/5 bg-white/[0.02] hover:bg-teal-500/10 hover:border-teal-500/20 text-slate-400 hover:text-slate-200 transition-all"
                                            (click)="sendSuggestion(suggestion)">
                                            {{ suggestion }}
                                        </button>
                                    }
                                </div>
                            </div>
                        }

                        @for (msg of displayMessages(); track msg.id) {
                            <div class="flex gap-3 max-w-3xl mx-auto w-full" [class.flex-row-reverse]="msg.role === 'user'">
                                <!-- Avatar -->
                                <div class="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                                    [class.bg-teal-500/20]="msg.role === 'assistant'"
                                    [class.border-teal-500/30]="msg.role === 'assistant'"
                                    [class.bg-violet-500/20]="msg.role === 'user'"
                                    [class.border-violet-500/30]="msg.role === 'user'"
                                    [class.border]="true">
                                    <lucide-icon
                                        [img]="msg.role === 'user' ? UserIcon : BotIcon"
                                        size="16"
                                        [class.text-teal-400]="msg.role === 'assistant'"
                                        [class.text-violet-400]="msg.role === 'user'">
                                    </lucide-icon>
                                </div>
                                <!-- Content -->
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1" [class.justify-end]="msg.role === 'user'">
                                        <span class="text-xs font-medium" [class.text-teal-400]="msg.role === 'assistant'" [class.text-violet-400]="msg.role === 'user'">
                                            {{ msg.role === 'user' ? 'You' : 'Kammi' }}
                                        </span>
                                        <span class="text-[10px] text-slate-600">{{ formatTime(msg.timestamp) }}</span>
                                    </div>
                                    <div class="message-bubble px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
                                        [class.user-bubble]="msg.role === 'user'"
                                        [class.assistant-bubble]="msg.role === 'assistant'">
                                        {{ msg.content }}
                                        @if (msg.isStreaming) {
                                            <span class="inline-flex gap-1 ml-1 align-middle">
                                                <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style="animation-delay: 0ms"></span>
                                                <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style="animation-delay: 150ms"></span>
                                                <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style="animation-delay: 300ms"></span>
                                            </span>
                                        }
                                    </div>
                                </div>
                            </div>
                        }
                    </div>

                    <!-- Input Area -->
                    <div class="shrink-0 border-t border-white/10 px-4 py-4 chat-input-area">
                        <div class="max-w-3xl mx-auto flex items-end gap-3">
                            <div class="flex-1 relative">
                                <textarea
                                    #messageInput
                                    class="w-full px-4 py-3 pr-12 text-sm rounded-xl border border-teal-500/20 bg-black/30 text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30 resize-none transition-all"
                                    [placeholder]="'Ask Kammi anything...'"
                                    [(ngModel)]="currentMessage"
                                    (keydown.enter)="onEnterKey($event)"
                                    [disabled]="isStreaming()"
                                    rows="1"
                                    style="max-height: 150px"
                                ></textarea>
                            </div>
                            <button
                                class="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all send-btn"
                                [class.active]="currentMessage.trim() && !isStreaming()"
                                [disabled]="!currentMessage.trim() || isStreaming()"
                                (click)="sendMessage()">
                                <lucide-icon [img]="SendIcon" size="18"></lucide-icon>
                            </button>
                        </div>
                        <div class="max-w-3xl mx-auto mt-2 flex items-center gap-3">
                            <div class="flex items-center gap-1.5">
                                <button
                                    class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors"
                                    [class.bg-teal-600]="indexEnabled()"
                                    [class.text-white]="indexEnabled()"
                                    [class.text-slate-500]="!indexEnabled()"
                                    [class.hover:text-slate-300]="!indexEnabled()"
                                    (click)="toggleIndexMode()">
                                    <lucide-icon [img]="DatabaseIcon" size="10"></lucide-icon>
                                    Index {{ indexEnabled() ? 'ON' : 'OFF' }}
                                </button>
                            </div>
                            <span class="text-[10px] text-slate-600">{{ goChatService.messageCount() }} messages in thread</span>
                        </div>
                    </div>
                </div>

                <!-- Settings Panel (right) -->
                @if (showSettings()) {
                    <div class="w-80 border-l border-white/10 bg-[#12121a] overflow-y-auto shrink-0 custom-scrollbar">
                        <div class="p-4 space-y-5">
                            <div class="flex items-center justify-between">
                                <h3 class="text-sm font-semibold text-white">Settings</h3>
                                <button class="p-1 rounded text-slate-400 hover:text-white" (click)="showSettings.set(false)">
                                    <lucide-icon [img]="XIcon" size="14"></lucide-icon>
                                </button>
                            </div>

                            <!-- Provider Tabs -->
                            <div class="flex gap-1 p-1 bg-white/5 rounded-lg">
                                <button
                                    class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                                    [class.bg-teal-600]="activeProvider() === 'google'"
                                    [class.text-white]="activeProvider() === 'google'"
                                    [class.text-slate-400]="activeProvider() !== 'google'"
                                    (click)="activeProvider.set('google')">
                                    Google Gemini
                                </button>
                                <button
                                    class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                                    [class.bg-teal-600]="activeProvider() === 'go-openrouter'"
                                    [class.text-white]="activeProvider() === 'go-openrouter'"
                                    [class.text-slate-400]="activeProvider() !== 'go-openrouter'"
                                    (click)="activeProvider.set('go-openrouter')">
                                    OpenRouter (Go)
                                </button>
                            </div>

                            <!-- Google Settings -->
                            @if (activeProvider() === 'google') {
                                <div class="space-y-3">
                                    <div class="space-y-1">
                                        <label class="text-xs font-medium text-slate-400">Google AI API Key</label>
                                        <input type="password"
                                            class="settings-input"
                                            placeholder="AIza..."
                                            [value]="googleApiKeyInput()"
                                            (input)="googleApiKeyInput.set($any($event.target).value)" />
                                    </div>
                                    <div class="space-y-1">
                                        <label class="text-xs font-medium text-slate-400">Model</label>
                                        <select class="settings-input"
                                            [value]="googleModelInput()"
                                            (change)="googleModelInput.set($any($event.target).value)">
                                            @for (model of googleGenAI.availableModels; track model.id) {
                                                <option [value]="model.id">{{ model.name }}</option>
                                            }
                                        </select>
                                    </div>
                                </div>
                            }

                            <!-- OpenRouter Settings -->
                            @if (activeProvider() === 'go-openrouter') {
                                <div class="space-y-3">
                                    <div class="space-y-1">
                                        <label class="text-xs font-medium text-slate-400">OpenRouter API Key</label>
                                        <input type="password"
                                            class="settings-input"
                                            placeholder="sk-or-..."
                                            [value]="apiKeyInput()"
                                            (input)="apiKeyInput.set($any($event.target).value)" />
                                    </div>
                                    <div class="space-y-2">
                                        <label class="text-xs font-medium text-slate-400">Model</label>
                                        <div class="px-2 py-1.5 bg-teal-900/30 border border-teal-500/30 rounded-md">
                                            <span class="text-xs text-teal-300 font-mono truncate block">{{ selectedModel() || 'None' }}</span>
                                        </div>
                                        <div class="flex gap-1">
                                            <input type="text"
                                                class="settings-input flex-1 !text-xs font-mono"
                                                placeholder="provider/model-id"
                                                [value]="customModelInput()"
                                                (input)="customModelInput.set($any($event.target).value)"
                                                (keydown.enter)="addCustomModel()" />
                                            <button class="shrink-0 px-2 py-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded-md transition-colors disabled:opacity-40"
                                                [disabled]="!customModelInput().trim()"
                                                (click)="addCustomModel()">Add</button>
                                        </div>
                                        <div class="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                                            @for (model of savedModels(); track model) {
                                                <div class="group flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-[10px] font-mono cursor-pointer border transition-colors"
                                                    [class.bg-teal-600]="selectedModel() === model"
                                                    [class.text-white]="selectedModel() === model"
                                                    [class.border-teal-500]="selectedModel() === model"
                                                    [class.bg-white/5]="selectedModel() !== model"
                                                    [class.text-slate-400]="selectedModel() !== model"
                                                    [class.border-white/10]="selectedModel() !== model"
                                                    (click)="selectedModel.set(model)">
                                                    <span class="max-w-[140px] truncate">{{ model }}</span>
                                                    <button class="ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                                                        (click)="$event.stopPropagation(); removeModel(model)">&times;</button>
                                                </div>
                                            }
                                        </div>
                                    </div>
                                    <div class="grid grid-cols-2 gap-3">
                                        <div class="space-y-1">
                                            <label class="text-[10px] text-slate-400 flex justify-between"><span>Temperature</span><span>{{ temperatureInput() }}</span></label>
                                            <input type="range" min="0" max="2" step="0.1" class="w-full accent-teal-500"
                                                [value]="temperatureInput()" (input)="temperatureInput.set(+$any($event.target).value)" />
                                        </div>
                                        <div class="space-y-1">
                                            <label class="text-[10px] text-slate-400 flex justify-between"><span>Max Tokens</span><span>{{ maxTokensInput() }}</span></label>
                                            <input type="range" min="256" max="131072" step="256" class="w-full accent-teal-500"
                                                [value]="maxTokensInput()" (input)="maxTokensInput.set(+$any($event.target).value)" />
                                        </div>
                                    </div>

                                    <!-- Reasoning -->
                                    <div class="p-2 rounded-md border border-teal-500/20 bg-teal-950/20 space-y-2">
                                        <div class="flex items-center justify-between">
                                            <label class="text-xs font-medium">Reasoning</label>
                                            <button class="relative w-10 h-5 rounded-full transition-colors"
                                                [class.bg-teal-600]="reasoningEnabledInput()"
                                                [class.bg-white/10]="!reasoningEnabledInput()"
                                                (click)="reasoningEnabledInput.set(!reasoningEnabledInput())">
                                                <span class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                                                    [class.translate-x-5]="reasoningEnabledInput()"></span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            }

                            <!-- System Prompt -->
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <label class="text-xs font-medium text-slate-300">Custom Instructions</label>
                                    <button class="text-[10px] text-slate-500 hover:text-teal-400" (click)="resetSystemPrompt()">
                                        <lucide-icon [img]="RotateCcwIcon" size="10" class="inline mr-0.5"></lucide-icon>Reset
                                    </button>
                                </div>
                                <textarea class="settings-input !h-28 resize-none text-xs leading-relaxed"
                                    [value]="systemPromptInput()"
                                    (input)="systemPromptInput.set($any($event.target).value)"
                                    placeholder="System instructions..."></textarea>
                            </div>

                            <!-- Save -->
                            <div class="flex gap-2">
                                <button class="flex-1 px-3 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-md transition-colors"
                                    (click)="saveSettings()">Save Settings</button>
                            </div>
                        </div>
                    </div>
                }
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }

        .chat-page-bg {
            background: linear-gradient(180deg, #0a0a0f 0%, #0d1117 50%, #0a0a0f 100%);
        }

        .chat-input-area {
            background: linear-gradient(to top,
                rgba(17, 94, 89, 0.08) 0%,
                transparent 100%
            );
        }

        .user-bubble {
            background: linear-gradient(135deg, rgba(17, 94, 89, 0.3) 0%, rgba(20, 184, 166, 0.2) 100%);
            border: 1px solid rgba(20, 184, 166, 0.25);
            color: #e2e8f0;
        }

        .assistant-bubble {
            background: rgba(255, 255, 255, 0.03);
            border-left: 2px solid rgba(20, 184, 166, 0.4);
            border-radius: 0 16px 16px 0 !important;
            color: #cbd5e1;
        }

        .send-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #64748b;
            cursor: not-allowed;
        }

        .send-btn.active {
            background: linear-gradient(135deg, #115e59 0%, #134e4a 50%, #0f2a2e 100%);
            border-color: rgba(20, 184, 166, 0.4);
            color: #e2e8f0;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(17, 94, 89, 0.4);
        }

        .send-btn.active:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(17, 94, 89, 0.5);
        }

        .settings-input {
            width: 100%;
            padding: 8px 12px;
            font-size: 13px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #e2e8f0;
            outline: none;
            transition: border-color 0.2s;
        }

        .settings-input:focus {
            border-color: #14b8a6;
            box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15);
        }

        .custom-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: rgba(20, 184, 166, 0.2) transparent;
        }

        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(20, 184, 166, 0.2); border-radius: 3px; }
    `]
})
export class AiChatPageComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;

    private router = inject(Router);
    goChatService = inject(GoChatService);
    googleGenAI = inject(GoogleGenAIService);
    private orchestrator = inject(OrchestratorService);
    private chatContextClipStore = inject(ChatContextClipStore);
    private goChatInitialized = false;

    // Icons
    readonly ArrowLeft = ArrowLeft;
    readonly PlusIcon = Plus;
    readonly Trash2Icon = Trash2;
    readonly DownloadIcon = Download;
    readonly SettingsIcon = Settings;
    readonly SendIcon = Send;
    readonly HistoryIcon = History;
    readonly DatabaseIcon = Database;
    readonly BrainIcon = Brain;
    readonly RotateCcwIcon = RotateCcw;
    readonly BotIcon = Bot;
    readonly UserIcon = User;
    readonly SparklesIcon = Sparkles;
    readonly MessageCircleIcon = MessageCircle;
    readonly XIcon = X;

    // UI state
    showSettings = signal(false);
    showHistory = signal(false);
    isStreaming = signal(false);
    currentMessage = '';

    // Provider
    activeProvider = signal<'google' | 'go-openrouter'>('go-openrouter');

    // OpenRouter settings
    apiKeyInput = signal('');
    selectedModel = signal('nvidia/nemotron-3-nano-30b-a3b:free');
    temperatureInput = signal(0.7);
    maxTokensInput = signal(2048);
    reasoningEnabledInput = signal(true);
    reasoningEffortInput = signal<'low' | 'medium' | 'high'>('medium');
    reasoningMaxTokensInput = signal(1024);

    // Google settings
    googleApiKeyInput = signal('');
    googleModelInput = signal('gemini-3-flash-preview');

    // System prompt
    systemPromptInput = signal(KAMMI_SYSTEM_PROMPT);

    // Index mode
    indexEnabled = signal(false);

    // Models
    private readonly MODELS_KEY = 'openrouter:models';
    private readonly MODEL_SEEDS = [
        'nvidia/nemotron-3-nano-30b-a3b:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemini-3-flash-preview',
        'deepseek/deepseek-r1:free',
        'mistralai/mistral-nemo:free',
    ];
    savedModels = signal<string[]>(this.loadSavedModels());
    customModelInput = signal('');

    // History
    sessions = signal<SessionInfo[]>([]);

    // Display messages
    displayMessages = signal<DisplayMessage[]>([]);

    // Suggestions
    readonly suggestions = [
        '✨ Help me develop a character backstory',
        '🗺️ Create a magic system for my world',
        '📖 Outline a three-act story structure',
        '🏰 Describe a fantasy city in detail',
    ];

    readonly isGoConfigured = computed(() => !!this.apiKeyInput());

    ngOnInit(): void {
        this.loadSettings();
        this.initGoChatService();
    }

    ngAfterViewInit(): void {
        this.restoreHistory();
        this.scrollToBottom();
    }

    ngOnDestroy(): void {}

    // ---- Navigation ----
    navigateToEditor(): void {
        this.router.navigate(['/']);
    }

    // ---- Settings ----
    private loadSettings(): void {
        const savedOrConfig = getSetting<ChatConfig | null>('openrouter:config', null);
        if (savedOrConfig) {
            this.apiKeyInput.set(savedOrConfig.apiKey || '');
            this.selectedModel.set(savedOrConfig.model || 'nvidia/nemotron-3-nano-30b-a3b:free');
            this.temperatureInput.set(savedOrConfig.temperature ?? 0.7);
            this.maxTokensInput.set(savedOrConfig.maxTokens ?? 2048);
            this.reasoningEnabledInput.set(savedOrConfig.reasoningEnabled ?? true);
            this.reasoningEffortInput.set(savedOrConfig.reasoningEffort ?? 'medium');
            this.reasoningMaxTokensInput.set(savedOrConfig.reasoningMaxTokens ?? 1024);
        }

        const googleConfig = this.googleGenAI.config();
        if (googleConfig) {
            this.googleApiKeyInput.set(googleConfig.apiKey || '');
            this.googleModelInput.set(googleConfig.model || 'gemini-2.0-flash');
        }

        if (this.googleGenAI.isConfigured() && !savedOrConfig?.apiKey) {
            this.activeProvider.set('google');
        }

        const savedPrompt = getSetting<string | null>('chat:systemPrompt', null);
        if (savedPrompt) this.systemPromptInput.set(savedPrompt);

        this.indexEnabled.set(getSetting<boolean>('chat:indexMode', false));
    }

    toggleSettings(): void { this.showSettings.update(v => !v); }

    saveSettings(): void {
        if (this.apiKeyInput()) {
            const existing = getSetting<ChatConfig | null>('openrouter:config', null);
            const orConfig: ChatConfig = {
                apiKey: this.apiKeyInput(),
                model: this.selectedModel(),
                temperature: this.temperatureInput(),
                maxTokens: this.maxTokensInput(),
                reasoningEnabled: this.reasoningEnabledInput(),
                reasoningEffort: this.reasoningEffortInput(),
                reasoningMaxTokens: this.reasoningMaxTokensInput(),
                includeReasoning: this.reasoningEnabledInput(),
                structuredOutput: existing?.structuredOutput,
                plugins: existing?.plugins,
            };
            setSetting('openrouter:config', orConfig);
            this.goChatService.updateConfig({
                apiKey: orConfig.apiKey, model: orConfig.model,
                temperature: orConfig.temperature, maxTokens: orConfig.maxTokens,
                reasoningEnabled: orConfig.reasoningEnabled,
                reasoningEffort: orConfig.reasoningEffort,
                reasoningMaxTokens: orConfig.reasoningMaxTokens,
                includeReasoning: orConfig.includeReasoning,
                structuredOutput: orConfig.structuredOutput,
                plugins: orConfig.plugins, omEnabled: true,
            });
        }

        if (this.googleApiKeyInput()) {
            this.googleGenAI.saveConfig({
                apiKey: this.googleApiKeyInput(),
                model: this.googleModelInput(),
                temperature: 0.7,
                maxOutputTokens: 2048,
                systemPrompt: this.systemPromptInput(),
            });
        }

        setSetting('chat:systemPrompt', this.systemPromptInput());
        this.showSettings.set(false);
    }

    resetSystemPrompt(): void { this.systemPromptInput.set(KAMMI_SYSTEM_PROMPT); }

    getActiveProviderName(): string {
        if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
            return `Google Gemini (${this.googleGenAI.getModel()})`;
        }
        const model = this.selectedModel();
        return model ? `OpenRouter · ${model.split('/').pop()}` : 'OpenRouter';
    }

    toggleIndexMode(): void {
        this.indexEnabled.update(v => !v);
        setSetting('chat:indexMode', this.indexEnabled());
    }

    // ---- Models ----
    private loadSavedModels(): string[] {
        const stored = getSetting<string[] | null>(this.MODELS_KEY, null);
        if (stored && stored.length > 0) return stored;
        setSetting(this.MODELS_KEY, this.MODEL_SEEDS);
        return [...this.MODEL_SEEDS];
    }

    addCustomModel(): void {
        const id = this.customModelInput().trim();
        if (!id) return;
        if (!this.savedModels().includes(id)) {
            const updated = [id, ...this.savedModels()];
            this.savedModels.set(updated);
            setSetting(this.MODELS_KEY, updated);
        }
        this.selectedModel.set(id);
        this.customModelInput.set('');
    }

    removeModel(id: string): void {
        const updated = this.savedModels().filter(m => m !== id);
        this.savedModels.set(updated);
        setSetting(this.MODELS_KEY, updated);
        if (this.selectedModel() === id) this.selectedModel.set(updated[0] ?? '');
    }

    // ---- Go Chat Service ----
    private async initGoChatService(): Promise<void> {
        if (this.goChatInitialized) return;
        await this.goChatService.init();
        this.goChatInitialized = true;
    }

    // ---- History ----
    toggleHistory(): void {
        if (!this.showHistory()) {
            this.loadSessions();
        }
        this.showHistory.update(v => !v);
    }

    private loadSessions(): void {
        const threads = this.goChatService.threads();
        this.sessions.set(threads.map((t: Thread) => ({
            id: t.id,
            messageCount: 0,
            createdAt: t.created_at,
            preview: t.title || undefined,
        })));
    }

    async selectSession(sessionId: string): Promise<void> {
        await this.goChatService.loadThread(sessionId);
        this.showHistory.set(false);
        this.restoreHistory();
    }

    formatSessionDate(timestamp: number): string {
        const date = new Date(timestamp);
        const diff = Date.now() - date.getTime();
        if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diff < 604800000) return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // ---- Messages ----
    private restoreHistory(): void {
        const messages = this.goChatService.messages();
        this.displayMessages.set(messages.map((m: any) => ({
            id: this.generateId(),
            content: m.content,
            role: m.role as 'user' | 'assistant',
            timestamp: new Date(m.timestamp || Date.now()),
        })));
    }

    sendSuggestion(text: string): void {
        const clean = text.replace(/^[^\s]+\s/, ''); // Strip emoji prefix
        this.currentMessage = clean;
        this.sendMessage();
    }

    onEnterKey(event: Event): void {
        const kbEvent = event as KeyboardEvent;
        if (kbEvent.shiftKey) return; // Allow shift+enter for newlines
        kbEvent.preventDefault();
        this.sendMessage();
    }

    async sendMessage(): Promise<void> {
        const text = this.currentMessage.trim();
        if (!text || this.isStreaming()) return;

        this.currentMessage = '';
        this.isStreaming.set(true);

        // Add user message to display
        const userMsg: DisplayMessage = {
            id: this.generateId(), content: text, role: 'user', timestamp: new Date(),
        };
        this.displayMessages.update(msgs => [...msgs, userMsg]);
        await this.goChatService.addUserMessage(text);
        this.scrollToBottom();

        // Check provider config
        const googleConfigured = this.googleGenAI.isConfigured();
        const orConfigured = this.isGoConfigured();
        if (!googleConfigured && !orConfigured) {
            this.addBotMessage('[Warning] Please configure an API key in settings to enable AI responses.');
            this.isStreaming.set(false);
            return;
        }

        // Build context
        let contextBlock = '';
        let activation: ActivationResult | null = null;
        if (this.indexEnabled()) {
            try {
                const threadId = this.goChatService.currentThread()?.id || 'default';
                contextBlock = await this.orchestrator.orchestrate(text, threadId);
                activation = this.orchestrator.lastActivation();
            } catch (err) {
                console.error('[AiChatPage] Orchestrator error:', err);
            }
        }

        const highlightedClips = this.chatContextClipStore.consumeAll();
        const highlightedContext = this.chatContextClipStore.formatForPrompt(highlightedClips);

        const history = this.buildConversationHistory();
        const effectiveSystemPrompt = this.systemPromptInput()
            + (contextBlock ? '\n\n' + contextBlock : '')
            + (highlightedContext ? '\n\n' + highlightedContext : '');

        // Create streaming bot message
        const botMsg: DisplayMessage = {
            id: this.generateId(), content: '', role: 'assistant', timestamp: new Date(), isStreaming: true,
        };
        this.displayMessages.update(msgs => [...msgs, botMsg]);
        this.scrollToBottom();

        // Stream response
        await this.streamResponse(botMsg, history, effectiveSystemPrompt);
    }

    private async streamResponse(
        botMsg: DisplayMessage,
        history: OpenRouterMessage[],
        systemPrompt: string,
    ): Promise<void> {
        const updateContent = (chunk: string) => {
            this.displayMessages.update(msgs =>
                msgs.map(m => m.id === botMsg.id ? { ...m, content: m.content + chunk } : m)
            );
            this.scrollToBottom();
        };

        const finalize = async (fullText: string) => {
            this.displayMessages.update(msgs =>
                msgs.map(m => m.id === botMsg.id ? { ...m, content: fullText, isStreaming: false } : m)
            );
            await this.goChatService.addAssistantMessage(fullText);
            this.isStreaming.set(false);
            this.scrollToBottom();
        };

        const onError = (error: Error) => {
            this.displayMessages.update(msgs =>
                msgs.map(m => m.id === botMsg.id ? { ...m, content: `Error: ${error.message}`, isStreaming: false } : m)
            );
            this.isStreaming.set(false);
        };

        try {
            if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
                const googleHistory: GoogleGenAIMessage[] = history
                    .filter(m => m.role !== 'system')
                    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] }));

                await this.googleGenAI.streamChat(googleHistory, {
                    onChunk: updateContent,
                    onComplete: finalize,
                    onError,
                }, systemPrompt);
            } else {
                await this.goChatService.streamChat(history, {
                    onChunk: updateContent,
                    onComplete: finalize,
                    onError,
                }, systemPrompt);
            }
        } catch (err) {
            onError(err instanceof Error ? err : new Error(String(err)));
        }
    }

    private buildConversationHistory(): OpenRouterMessage[] {
        return this.goChatService.messages()
            .slice(-10)
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    private addBotMessage(content: string): void {
        this.displayMessages.update(msgs => [...msgs, {
            id: this.generateId(), content, role: 'assistant', timestamp: new Date(),
        }]);
        this.scrollToBottom();
    }

    // ---- Actions ----
    async newSession(): Promise<void> {
        await this.goChatService.newSession();
        this.displayMessages.set([]);
    }

    async clearChat(): Promise<void> {
        await this.goChatService.clearThread();
        this.displayMessages.set([]);
    }

    async exportChat(): Promise<void> {
        const json = await this.goChatService.exportThread();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat-${this.goChatService.currentThread()?.id || 'unknown'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ---- Helpers ----
    formatTime(date: Date): string {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    private scrollToBottom(): void {
        setTimeout(() => {
            if (this.messagesContainer) {
                const el = this.messagesContainer.nativeElement;
                el.scrollTop = el.scrollHeight;
            }
        }, 50);
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 11);
    }
}
