/**
 * AI Chat Panel Component
 *
 * Wraps quikchat vanilla JS library with Angular integration.
 * Uses GoChatService for Go/SQLite persistence + memory extraction.
 *
 * Architecture:
 * - GoChatService (Go WASM) — persistence, thread management, OpenRouter streaming
 * - GoogleGenAIService (TypeScript) — Google Gemini streaming fallback
 */

import {
    Component,
    inject,
    AfterViewInit,
    OnDestroy,
    ElementRef,
    ViewChild,
    signal,
    computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Trash2, Download, Plus, Settings, Send, History, ArrowLeft, Database, Brain, RotateCcw } from 'lucide-angular';
import { getSetting, setSetting } from '../../../lib/dexie/settings.service';
import { GoChatService, type Thread, type ChatConfig, type ChatProgressEvent, type OpenRouterMessage } from '../../../lib/services/go-chat.service';
import { OrchestratorService } from '../../../services/orchestrator.service';
import { GoogleGenAIService, GoogleGenAIMessage } from '../../../lib/services/google-genai.service';
import { ChatContextClipStore } from '../../../lib/store/chat-context-clip.store';
import type { ActivationResult } from '../../../lib/rlm';

// Import quikchat (vanilla JS lib)
declare const quikchat: any;

interface SessionInfo {
    id: string;
    messageCount: number;
    createdAt: number;
    preview?: string;
}

interface ActivityTraceStep {
    id: string;
    kind: 'reasoning' | 'tool' | 'stream' | 'status';
    label: string;
    detail?: string;
    status: 'running' | 'done' | 'error';
    latencyMs?: number;
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
    selector: 'app-ai-chat-panel',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    template: `
        <div class="ai-chat-wrapper h-full flex flex-col overflow-hidden">
            <!-- Chat Header -->
            <div class="chat-header px-3 py-2 border-b border-border/50 flex items-center gap-2 shrink-0">
                @if (showHistory()) {
                    <button 
                        class="chat-action-btn"
                        title="Back to Chat"
                        (click)="showHistory.set(false)">
                        <lucide-icon [img]="ArrowLeftIcon" class="h-4 w-4"></lucide-icon>
                    </button>
                    <span class="text-sm font-medium">Chat History</span>
                } @else {
                    <button 
                        class="chat-action-btn"
                        title="New Chat"
                        (click)="newSession()">
                        <lucide-icon [img]="PlusIcon" class="h-4 w-4"></lucide-icon>
                    </button>
                    <button 
                        class="chat-action-btn"
                        title="Clear Chat"
                        (click)="clearChat()">
                        <lucide-icon [img]="Trash2Icon" class="h-4 w-4"></lucide-icon>
                    </button>
                    <button 
                        class="chat-action-btn"
                        title="Export Chat"
                        (click)="exportChat()">
                        <lucide-icon [img]="DownloadIcon" class="h-4 w-4"></lucide-icon>
                    </button>
                    <button 
                        class="chat-action-btn"
                        title="Chat History"
                        (click)="openHistory()">
                        <lucide-icon [img]="HistoryIcon" class="h-4 w-4"></lucide-icon>
                    </button>
                    <button 
                        class="chat-action-btn ml-auto"
                        [class.text-teal-400]="isGoConfigured()"
                        [class.text-amber-400]="!isGoConfigured()"
                        title="Settings"
                        (click)="toggleSettings()">
                        <lucide-icon [img]="SettingsIcon" class="h-4 w-4"></lucide-icon>
                    </button>
                }
            </div>

            <!-- Settings Panel -->
            @if (showSettings()) {
                <div class="settings-panel p-3 border-b border-border/50 bg-muted/30 space-y-3">
                    <!-- Provider Tabs -->
                    <div class="flex gap-1 p-1 bg-muted/50 rounded-lg">
                        <button 
                            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                            [class.bg-teal-600]="activeProvider() === 'google'"
                            [class.text-white]="activeProvider() === 'google'"
                            [class.text-muted-foreground]="activeProvider() !== 'google'"
                            (click)="activeProvider.set('google')">
                            Google Gemini
                        </button>
                        <button 
                            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                            [class.bg-teal-600]="activeProvider() === 'go-openrouter'"
                            [class.text-white]="activeProvider() === 'go-openrouter'"
                            [class.text-muted-foreground]="activeProvider() !== 'go-openrouter'"
                            (click)="activeProvider.set('go-openrouter')">
                            OpenRouter (Go)
                        </button>
                    </div>

                    <!-- Google GenAI Settings -->
                    @if (activeProvider() === 'google') {
                        <div class="space-y-1">
                            <label class="text-xs font-medium text-muted-foreground">Google AI API Key</label>
                            <input 
                                type="password"
                                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500"
                                placeholder="AIza..."
                                [value]="googleApiKeyInput()"
                                (input)="googleApiKeyInput.set($any($event.target).value)"
                            />
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-medium text-muted-foreground">Model</label>
                            <select 
                                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500"
                                [value]="googleModelInput()"
                                (change)="googleModelInput.set($any($event.target).value)"
                            >
                                @for (model of googleGenAI.availableModels; track model.id) {
                                    <option [value]="model.id">{{ model.name }} - {{ model.description }}</option>
                                }
                            </select>
                        </div>
                        @if (!googleGenAI.isConfigured()) {
                            <p class="text-xs text-amber-400">
                                ⚠️ Get your API key at <a href="https://aistudio.google.com/apikey" target="_blank" class="underline">aistudio.google.com</a>
                            </p>
                        }
                    }

                    <!-- Go OpenRouter Settings -->
                    @if (activeProvider() === 'go-openrouter') {
                        <div class="space-y-1">
                            <label class="text-xs font-medium text-muted-foreground">OpenRouter API Key</label>
                            <input 
                                type="password"
                                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500"
                                placeholder="sk-or-..."
                                [value]="apiKeyInput()"
                                (input)="apiKeyInput.set($any($event.target).value)"
                            />
                        </div>
                        <!-- Model Picker -->
                        <div class="space-y-2">
                            <label class="text-xs font-medium text-muted-foreground">Model</label>

                            <!-- Current selection badge -->
                            <div class="px-2 py-1.5 bg-teal-900/30 border border-teal-500/30 rounded-md flex items-center justify-between">
                                <span class="text-xs text-teal-300 font-mono truncate">{{ selectedModel() || 'None selected' }}</span>
                            </div>

                            <!-- Add custom model input -->
                            <div class="flex gap-1">
                                <input
                                    type="text"
                                    class="flex-1 px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500 font-mono placeholder:text-muted-foreground/50"
                                    placeholder="provider/model-id:free"
                                    [value]="customModelInput()"
                                    (input)="customModelInput.set($any($event.target).value)"
                                    (keydown.enter)="addCustomModel()"
                                />
                                <button
                                    class="shrink-0 px-2 py-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded-md transition-colors disabled:opacity-40"
                                    [disabled]="!customModelInput().trim()"
                                    (click)="addCustomModel()"
                                >Add</button>
                            </div>

                            <!-- Model pill list -->
                            <div class="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                                @for (model of savedModels(); track model) {
                                    <div
                                        class="group flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-[10px] font-mono cursor-pointer border transition-colors"
                                        [class.bg-teal-600]="selectedModel() === model"
                                        [class.text-white]="selectedModel() === model"
                                        [class.border-teal-500]="selectedModel() === model"
                                        [class.bg-muted]="selectedModel() !== model"
                                        [class.text-muted-foreground]="selectedModel() !== model"
                                        [class.border-border]="selectedModel() !== model"
                                        [class.hover:bg-muted-foreground/10]="selectedModel() !== model"
                                        (click)="selectedModel.set(model)"
                                    >
                                        <span class="max-w-[140px] truncate">{{ model }}</span>
                                        <button
                                            class="ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-inherit leading-none"
                                            (click)="$event.stopPropagation(); removeModel(model)"
                                            title="Remove"
                                        >&times;</button>
                                    </div>
                                }
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2 mt-2">
                            <div class="space-y-1">
                                <label class="text-xs font-medium text-muted-foreground flex justify-between">
                                    <span>Temperature</span>
                                    <span>{{ temperatureInput() }}</span>
                                </label>
                                <input 
                                    type="range"
                                    min="0" max="2" step="0.1"
                                    class="w-full"
                                    [value]="temperatureInput()"
                                    (input)="temperatureInput.set(+$any($event.target).value)"
                                />
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-medium text-muted-foreground flex justify-between">
                                    <span>Max Tokens</span>
                                    <span>{{ maxTokensInput() }}</span>
                                </label>
                                <input 
                                    type="range"
                                    min="256" max="131072" step="256"
                                    class="w-full"
                                    [value]="maxTokensInput()"
                                    (input)="maxTokensInput.set(+$any($event.target).value)"
                                />
                            </div>
                        </div>

                        <!-- OpenRouter Reasoning Controls -->
                        <div class="mt-2 p-2 rounded-md border border-teal-500/20 bg-teal-950/20 space-y-2">
                            <div class="flex items-center justify-between">
                                <div>
                                    <label class="text-xs font-medium">Reasoning</label>
                                    <p class="text-[10px] text-muted-foreground">Show model reasoning summaries and richer thought flow.</p>
                                </div>
                                <button
                                    class="relative w-11 h-6 rounded-full transition-colors"
                                    [class.bg-teal-600]="reasoningEnabledInput()"
                                    [class.bg-muted]="!reasoningEnabledInput()"
                                    (click)="reasoningEnabledInput.set(!reasoningEnabledInput())"
                                >
                                    <span
                                        class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                                        [class.translate-x-5]="reasoningEnabledInput()"
                                    ></span>
                                </button>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                <div class="space-y-1">
                                    <label class="text-[10px] text-muted-foreground">Reasoning Effort</label>
                                    <select
                                        class="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500"
                                        [value]="reasoningEffortInput()"
                                        (change)="reasoningEffortInput.set($any($event.target).value)"
                                    >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[10px] text-muted-foreground flex justify-between">
                                        <span>Reasoning Tokens</span>
                                        <span>{{ reasoningMaxTokensInput() }}</span>
                                    </label>
                                    <input
                                        type="range"
                                        min="0" max="8192" step="128"
                                        class="w-full"
                                        [value]="reasoningMaxTokensInput()"
                                        (input)="reasoningMaxTokensInput.set(+$any($event.target).value)"
                                    />
                                </div>
                            </div>
                        </div>
                    }

                    <!-- Index Mode Toggle -->
                    <div class="flex items-center justify-between py-1">
                        <div class="flex items-center gap-2">
                            <lucide-icon [img]="DatabaseIcon" class="h-4 w-4 text-muted-foreground"></lucide-icon>
                            <div>
                                <label class="text-xs font-medium">Index Mode</label>
                                <p class="text-[10px] text-muted-foreground">Enable note & entity search</p>
                            </div>
                        </div>
                        <button
                            class="relative w-11 h-6 rounded-full transition-colors"
                            [class.bg-teal-600]="indexEnabled()"
                            [class.bg-muted]="!indexEnabled()"
                            (click)="toggleIndexMode()"
                        >
                            <span
                                class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                                [class.translate-x-5]="indexEnabled()"
                            ></span>
                        </button>
                    </div>

                    <!-- Custom Instructions (Collapsible) -->
                    <div class="border-t border-border/30 pt-2 mt-2">
                        <button 
                            class="flex items-center justify-between w-full py-1 group"
                            (click)="toggleSystemPrompt()">
                            <div class="flex items-center gap-2">
                                <lucide-icon [img]="SettingsIcon" class="h-4 w-4 text-muted-foreground group-hover:text-teal-400 transition-colors"></lucide-icon>
                                <div class="text-left">
                                    <label class="text-xs font-medium cursor-pointer group-hover:text-teal-400 transition-colors">Custom Instructions</label>
                                    <p class="text-[10px] text-muted-foreground">Customize Kammi's persona & behavior</p>
                                </div>
                            </div>
                            <div class="text-[10px] text-muted-foreground group-hover:text-teal-400 transition-colors">
                                {{ showSystemPrompt() ? 'Hide' : 'Edit' }}
                            </div>
                        </button>
                        
                        @if (showSystemPrompt()) {
                            <div class="mt-2 space-y-2 pl-1 animation-slide-down">
                                <textarea
                                    class="w-full h-32 px-3 py-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none leading-relaxed"
                                    [value]="systemPromptInput()"
                                    (input)="systemPromptInput.set($any($event.target).value)"
                                    placeholder="Enter system instructions..."
                                ></textarea>
                                <div class="flex justify-end">
                                    <button 
                                        class="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground hover:text-teal-400 hover:bg-teal-500/10 rounded transition-colors"
                                        (click)="resetSystemPrompt()"
                                        title="Reset to default Kammi persona">
                                        <lucide-icon [img]="RotateCcwIcon" class="h-3 w-3"></lucide-icon>
                                        Reset to Default
                                    </button>
                                </div>
                            </div>
                        }
                    </div>

                    <!-- Save/Cancel Buttons -->
                    <div class="flex gap-2">
                        <button 
                            class="flex-1 px-3 py-1.5 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-md transition-colors"
                            (click)="saveSettings()">
                            Save
                        </button>
                        <button 
                            class="px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded-md transition-colors"
                            (click)="showSettings.set(false)">
                            Cancel
                        </button>
                    </div>

                    <!-- Active Provider Indicator -->
                    @if (googleGenAI.isConfigured() || isGoConfigured()) {
                        <div class="text-[10px] text-center text-muted-foreground">
                            Using: <span class="text-teal-400 font-medium">{{ getActiveProviderName() }}</span>
                        </div>
                    }
                </div>
            }

            <!-- History Panel -->
            @if (showHistory()) {
                <div class="flex-1 overflow-y-auto p-3 space-y-2">
                    @for (session of sessions(); track session.id) {
                        <button 
                            class="w-full p-3 text-left rounded-lg border transition-all"
                            [class.border-teal-500]="session.id === goChatService.currentThread()?.id"
                            [class.bg-teal-500/10]="session.id === goChatService.currentThread()?.id"
                            [class.border-border/50]="session.id !== goChatService.currentThread()?.id"
                            [class.hover:bg-muted/50]="session.id !== goChatService.currentThread()?.id"
                            (click)="selectSession(session.id)"
                        >
                            <div class="flex items-center justify-between">
                                <span class="text-xs font-medium truncate">{{ session.id }}</span>
                                <span class="text-[10px] text-muted-foreground">{{ session.messageCount }} msgs</span>
                            </div>
                            <div class="text-[10px] text-muted-foreground mt-1">
                                {{ formatSessionDate(session.createdAt) }}
                            </div>
                            @if (session.preview) {
                                <div class="text-xs text-muted-foreground mt-1 truncate italic">
                                    "{{ session.preview }}"
                                </div>
                            }
                        </button>
                    } @empty {
                        <div class="text-center py-8 text-muted-foreground">
                            <lucide-icon [img]="HistoryIcon" class="h-8 w-8 mx-auto opacity-30 mb-2"></lucide-icon>
                            <p class="text-xs">No chat history yet</p>
                        </div>
                    }
                </div>
            }

            <!-- Chat Container (always rendered but hidden when history showing) -->
            <div #chatContainer 
                class="chat-container"
                [class.hidden]="showHistory()"
            ></div>
        </div>
    `,
    styles: [`
        /* ============================================
           AI CHAT PANEL - Premium Teal Umbra Theme
           Matches app header/footer gradient aesthetic
           ============================================ */

        /* CRITICAL: Host must fill parent completely */
        :host {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 0;
            overflow: hidden;
        }

        .ai-chat-wrapper {
            display: flex;
            flex-direction: column;
            flex: 1 1 0;
            min-height: 0;
            overflow: hidden;
            background: linear-gradient(180deg, 
                hsl(var(--background)) 0%, 
                hsl(var(--background)) 85%,
                rgba(17, 94, 89, 0.05) 100%
            );
        }

        /* Header - subtle teal gradient like app header */
        .chat-header {
            flex-shrink: 0;
            background: linear-gradient(to right, 
                rgba(17, 94, 89, 0.15) 0%, 
                rgba(19, 78, 74, 0.1) 50%, 
                rgba(15, 42, 46, 0.08) 100%
            );
            border-bottom: 1px solid rgba(20, 184, 166, 0.15);
        }

        .chat-action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: transparent;
            border: none;
            color: hsl(var(--muted-foreground));
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .chat-action-btn:hover {
            background: rgba(20, 184, 166, 0.2);
            color: #14b8a6;
            transform: scale(1.05);
        }

        .settings-panel {
            animation: slideDown 0.2s ease-out;
            background: linear-gradient(180deg,
                rgba(17, 94, 89, 0.08) 0%,
                transparent 100%
            );
            border-bottom: 1px solid rgba(20, 184, 166, 0.1) !important;
        }

        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Chat container - must constrain quikchat to available space */
        .chat-container {
            flex: 1 1 0 !important;
            min-height: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
        }

        :host ::ng-deep .inline-trace {
            display: grid;
            gap: 10px;
        }

        :host ::ng-deep .inline-trace-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        :host ::ng-deep .inline-trace-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #67e8f9;
        }

        :host ::ng-deep .inline-trace-title .brain-mark {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            border-radius: 9999px;
            background: rgba(20, 184, 166, 0.14);
            border: 1px solid rgba(45, 212, 191, 0.2);
            color: #5eead4;
            font-size: 12px;
        }

        :host ::ng-deep .inline-trace-status {
            font-size: 11px;
            color: hsl(var(--muted-foreground));
        }

        :host ::ng-deep .inline-trace-steps {
            display: grid;
            gap: 8px;
        }

        :host ::ng-deep .inline-trace-step {
            display: grid;
            grid-template-columns: 10px 1fr auto;
            gap: 8px;
            align-items: start;
            padding: 8px 10px;
            border: 1px solid rgba(39, 39, 42, 0.9);
            border-radius: 12px;
            background: rgba(9, 9, 11, 0.52);
        }

        :host ::ng-deep .inline-trace-dot {
            width: 8px;
            height: 8px;
            margin-top: 4px;
            border-radius: 9999px;
            background: rgba(20, 184, 166, 0.55);
            box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
        }

        :host ::ng-deep .inline-trace-step.running .inline-trace-dot {
            background: rgb(45, 212, 191);
            box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.15), 0 0 12px rgba(45, 212, 191, 0.35);
        }

        :host ::ng-deep .inline-trace-step.error .inline-trace-dot {
            background: rgb(248, 113, 113);
            box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15);
        }

        :host ::ng-deep .inline-trace-step-title {
            font-size: 15px;
            line-height: 1.25;
            color: hsl(var(--foreground));
        }

        :host ::ng-deep .inline-trace-step-detail {
            margin-top: 2px;
            font-size: 12px;
            line-height: 1.4;
            color: hsl(var(--muted-foreground));
            word-break: break-word;
        }

        :host ::ng-deep .inline-trace-step-latency {
            font-size: 11px;
            color: hsl(var(--muted-foreground));
            white-space: nowrap;
        }



        /* ============================================
           QUIKCHAT OVERRIDES - Premium Teal Theme
           Using actual quikchat class names!
           ============================================ */

        /* Main container - flex column with input at bottom */
        :host ::ng-deep .quikchat-base {
            display: flex !important;
            flex-direction: column !important;
            height: 100% !important;
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            font-family: inherit !important;
            box-shadow: none !important;
        }

        /* Hide title area - we have our own header */
        :host ::ng-deep .quikchat-title-area {
            display: none !important;
        }

        /* Messages area - flex grow to push input down */
        :host ::ng-deep .quikchat-messages-area {
            flex: 1 1 auto !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            padding: 20px 16px !important;
            background: transparent !important;
            scrollbar-width: thin;
            scrollbar-color: rgba(20, 184, 166, 0.3) transparent;
        }

        /* Message wrapper */
        :host ::ng-deep .quikchat-message {
            margin-bottom: 18px;
            max-width: 92%;
            animation: fadeInUp 0.3s ease-out;
        }

        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        :host ::ng-deep .quikchat-message.left,
        :host ::ng-deep .quikchat-message.left-singleline,
        :host ::ng-deep .quikchat-message.left-multiline {
            margin-right: auto !important;
            padding: 12px 16px !important;
            background: linear-gradient(135deg,
                rgba(20, 184, 166, 0.06) 0%,
                transparent 100%
            ) !important;
            border-left: 2px solid rgba(20, 184, 166, 0.4) !important;
            border-radius: 0 12px 12px 0 !important;
            color: hsl(var(--foreground)) !important;
        }

        :host ::ng-deep .quikchat-message.right,
        :host ::ng-deep .quikchat-message.right-singleline,
        :host ::ng-deep .quikchat-message.right-multiline {
            margin-left: auto !important;
            padding: 12px 16px !important;
            background: linear-gradient(135deg, 
                rgba(17, 94, 89, 0.25) 0%, 
                rgba(20, 184, 166, 0.15) 100%
            ) !important;
            border: 1px solid rgba(20, 184, 166, 0.3) !important;
            border-radius: 18px 18px 4px 18px !important;
            color: hsl(var(--foreground)) !important;
            backdrop-filter: blur(12px);
            box-shadow: 
                0 2px 8px rgba(0, 0, 0, 0.1),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* ============================================
           INPUT AREA - Fixed at Bottom, Umbra Themed
           ============================================ */
        :host ::ng-deep .quikchat-input-area {
            flex: 0 0 auto !important;
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            padding: 16px !important;
            margin: 0 !important;
            height: auto !important;
            min-height: 72px !important;
            background: linear-gradient(to right, 
                rgba(17, 94, 89, 0.12) 0%, 
                rgba(19, 78, 74, 0.08) 50%, 
                rgba(15, 42, 46, 0.1) 100%
            ) !important;
            border-top: 1px solid rgba(20, 184, 166, 0.2) !important;
            border-radius: 0 !important;
        }

        /* Text Input - Dark themed with teal focus */
        :host ::ng-deep .quikchat-input-textbox {
            flex: 1 !important;
            padding: 12px 16px !important;
            border: 1px solid rgba(20, 184, 166, 0.2) !important;
            border-radius: 12px !important;
            background: rgba(0, 0, 0, 0.3) !important;
            color: hsl(var(--foreground)) !important;
            font-size: 14px !important;
            font-family: inherit !important;
            outline: none !important;
            transition: all 0.2s ease !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            height: auto !important;
            min-height: 44px !important;
        }

        :host ::ng-deep .quikchat-input-textbox:focus {
            border-color: #14b8a6 !important;
            background: rgba(0, 0, 0, 0.4) !important;
            box-shadow: 
                0 0 0 3px rgba(20, 184, 166, 0.15),
                0 0 20px rgba(20, 184, 166, 0.1) !important;
        }

        :host ::ng-deep .quikchat-input-textbox::placeholder {
            color: hsl(var(--muted-foreground)) !important;
        }

        /* SEND BUTTON - Teal Umbra Gradient (matches header/footer) */
        :host ::ng-deep .quikchat-input-send-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 44px !important;
            padding: 0 20px !important;
            border-radius: 10px !important;
            background: linear-gradient(135deg, 
                #115e59 0%, 
                #134e4a 50%, 
                #0f2a2e 100%
            ) !important;
            border: 1px solid rgba(20, 184, 166, 0.3) !important;
            color: #e2e8f0 !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            font-family: inherit !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
            box-shadow: 
                0 4px 12px rgba(17, 94, 89, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
            white-space: nowrap !important;
        }

        :host ::ng-deep .quikchat-input-send-btn:hover {
            transform: translateY(-1px) !important;
            box-shadow: 
                0 6px 16px rgba(17, 94, 89, 0.5),
                inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
        }

        :host ::ng-deep .quikchat-input-send-btn:active {
            transform: translateY(0) !important;
            box-shadow: 
                0 2px 8px rgba(17, 94, 89, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
        }

        /* ============================================
           LIGHT MODE - Adjusted for light sidebar
           ============================================ */
        :host-context(.light) .ai-chat-wrapper {
            background: linear-gradient(180deg, 
                hsl(var(--background)) 0%, 
                hsl(var(--background)) 85%,
                rgba(17, 94, 89, 0.03) 100%
            );
        }

        :host-context(.light) .chat-header {
            background: linear-gradient(to right, 
                rgba(17, 94, 89, 0.08) 0%, 
                rgba(19, 78, 74, 0.05) 50%, 
                rgba(15, 42, 46, 0.03) 100%
            );
        }

        :host-context(.light) ::ng-deep .quikchat-message.left,
        :host-context(.light) ::ng-deep .quikchat-message.left-singleline,
        :host-context(.light) ::ng-deep .quikchat-message.left-multiline {
            color: #18181b !important;
            background: linear-gradient(135deg,
                rgba(20, 184, 166, 0.08) 0%,
                rgba(20, 184, 166, 0.02) 100%
            ) !important;
        }

        :host-context(.light) ::ng-deep .quikchat-message.right,
        :host-context(.light) ::ng-deep .quikchat-message.right-singleline,
        :host-context(.light) ::ng-deep .quikchat-message.right-multiline {
            background: linear-gradient(135deg, 
                rgba(17, 94, 89, 0.15) 0%, 
                rgba(20, 184, 166, 0.1) 100%
            ) !important;
            border-color: rgba(20, 184, 166, 0.25) !important;
            color: #18181b !important;
        }

        :host-context(.light) ::ng-deep .quikchat-input-area {
            background: linear-gradient(to right, 
                rgba(17, 94, 89, 0.06) 0%, 
                rgba(19, 78, 74, 0.04) 50%, 
                rgba(15, 42, 46, 0.05) 100%
            ) !important;
            border-top-color: rgba(20, 184, 166, 0.15) !important;
        }

        :host-context(.light) ::ng-deep .quikchat-input-textbox {
            background: white !important;
            border-color: rgba(20, 184, 166, 0.2) !important;
            color: #18181b !important;
        }

        :host-context(.light) ::ng-deep .quikchat-input-textbox:focus {
            background: white !important;
            box-shadow: 
                0 0 0 3px rgba(20, 184, 166, 0.1),
                0 0 20px rgba(20, 184, 166, 0.05) !important;
        }

        :host-context(.light) ::ng-deep .quikchat-input-textbox::placeholder {
            color: #9ca3af !important;
        }
    `]
})
export class AiChatPanelComponent implements AfterViewInit, OnDestroy {
    @ViewChild('chatContainer', { static: true })
    chatContainer!: ElementRef<HTMLDivElement>;

    // GoChatService for persistence, memory, and Go OpenRouter streaming
    goChatService = inject(GoChatService);
    // Google GenAI fallback (TypeScript)
    googleGenAI = inject(GoogleGenAIService);
    private orchestrator = inject(OrchestratorService);
    private readonly chatContextClipStore = inject(ChatContextClipStore);
    private goChatInitialized = false;

    // Icon references for template
    readonly PlusIcon = Plus;
    readonly Trash2Icon = Trash2;
    readonly DownloadIcon = Download;
    readonly SettingsIcon = Settings;
    readonly HistoryIcon = History;
    readonly ArrowLeftIcon = ArrowLeft;
    readonly DatabaseIcon = Database;
    readonly BrainIcon = Brain;
    readonly RotateCcwIcon = RotateCcw;

    // Settings panel state
    showSettings = signal(false);
    activeProvider = signal<'google' | 'go-openrouter'>('go-openrouter'); // Go-first

    // Custom Instructions
    showSystemPrompt = signal(false);
    systemPromptInput = signal(KAMMI_SYSTEM_PROMPT);

    // OpenRouter settings
    apiKeyInput = signal('');
    selectedModel = signal('nvidia/nemotron-3-nano-30b-a3b:free');
    temperatureInput = signal(0.7);
    maxTokensInput = signal(2048);
    reasoningEnabledInput = signal(true);
    reasoningEffortInput = signal<'low' | 'medium' | 'high'>('medium');
    reasoningMaxTokensInput = signal(1024);

    // Per-message activity/timeline state (inline chat trace)
    activitySteps = signal<ActivityTraceStep[]>([]);
    private traceCounter = 0;
    private readonly traceStartedAt = new Map<string, number>();
    private currentTraceMsgId: number | null = null;


    // Persisted model list — seed + user-added models
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
    savedModels = signal<string[]>(this.loadSavedModels());
    customModelInput = signal('');

    // Google GenAI settings
    googleApiKeyInput = signal('');
    googleModelInput = signal('gemini-3-flash-preview');

    // Index toggle - enables tool calling
    indexEnabled = signal(false);

    /** True when a Go OpenRouter API key has been entered/saved. */
    readonly isGoConfigured = computed(() => !!this.apiKeyInput());

    // History panel state
    showHistory = signal(false);
    sessions = signal<SessionInfo[]>([]);

    // Current streaming message ID
    private currentBotMsgId: string | null = null;
    private chat: any = null;
    private scriptLoaded = false;

    ngAfterViewInit(): void {
        this.loadQuikChat();

        // Pre-fill Go OpenRouter config from saved openrouter:config (shared key store)
        const savedOrConfig = getSetting<ChatConfig | null>('openrouter:config', null);
        if (savedOrConfig) {
            this.apiKeyInput.set(savedOrConfig.apiKey || '');
            const restoredModel = savedOrConfig.model || 'nvidia/nemotron-3-nano-30b-a3b:free';
            this.selectedModel.set(restoredModel);
            // If the saved model isn't in the list yet, add it
            if (!this.savedModels().includes(restoredModel)) {
                this.savedModels.update(list => [restoredModel, ...list]);
                setSetting(this.MODELS_KEY, this.savedModels());
            }
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

        // Default to Go OpenRouter; fallback to Google if configured
        if (this.googleGenAI.isConfigured() && !savedOrConfig?.apiKey) {
            this.activeProvider.set('google');
        }

        // Initialize Go chat service
        this.initGoChatService();

        // Load saved system prompt
        const savedPrompt = getSetting<string | null>('chat:systemPrompt', null);
        if (savedPrompt) {
            this.systemPromptInput.set(savedPrompt);
        }

        const savedIndexMode = getSetting<boolean>('chat:indexMode', false);
        this.indexEnabled.set(savedIndexMode);
    }

    /**
     * Initialize Go chat service with OpenRouter config.
     * This enables persistence + memory extraction.
     */
    private async initGoChatService(): Promise<void> {
        if (this.goChatInitialized) return;
        // init() reads openrouter:config from Dexie internally when no arg provided
        await this.goChatService.init();
        this.goChatInitialized = true;
        console.log('[AiChatPanel] Go chat service initialized');
    }

    ngOnDestroy(): void {
        if (this.chat && typeof this.chat.destroy === 'function') {
            this.chat.destroy();
        }
        if (this.chatContainer?.nativeElement) {
            this.chatContainer.nativeElement.innerHTML = '';
        }
        this.chat = null;
    }

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------

    toggleSettings(): void {
        this.showSettings.update(v => !v);
    }

    saveSettings(): void {
        // Persist Go OpenRouter config to the shared openrouter:config key
        if (this.apiKeyInput()) {
            const existingOrConfig = getSetting<ChatConfig | null>('openrouter:config', null);
            const orConfig: ChatConfig = {
                apiKey: this.apiKeyInput(),
                model: this.selectedModel(),
                temperature: this.temperatureInput(),
                maxTokens: this.maxTokensInput(),
                reasoningEnabled: this.reasoningEnabledInput(),
                reasoningEffort: this.reasoningEffortInput(),
                reasoningMaxTokens: this.reasoningMaxTokensInput(),
                includeReasoning: this.reasoningEnabledInput(),
                structuredOutput: existingOrConfig?.structuredOutput,
                plugins: existingOrConfig?.plugins,
            };
            setSetting('openrouter:config', orConfig);

            // Hot-reload Go backend with new credentials
            this.goChatService.updateConfig({
                apiKey: orConfig.apiKey,
                model: orConfig.model,
                temperature: orConfig.temperature,
                maxTokens: orConfig.maxTokens,
                reasoningEnabled: orConfig.reasoningEnabled,
                reasoningEffort: orConfig.reasoningEffort,
                reasoningMaxTokens: orConfig.reasoningMaxTokens,
                includeReasoning: orConfig.includeReasoning,
                structuredOutput: orConfig.structuredOutput,
                plugins: orConfig.plugins,
                omEnabled: true,
            });
        }

        // Save Google GenAI config
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
        // console.log('[AiChatPanel] Settings saved, active provider:', this.activeProvider());
        this.showSettings.set(false);
    }

    getActiveProviderName(): string {
        if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
            return `Google Gemini (${this.googleGenAI.getModel()})`;
        }
        const model = this.selectedModel();
        return model ? `Go OpenRouter (${model.split('/').pop()})` : 'Go OpenRouter';
    }

    toggleIndexMode(): void {
        this.indexEnabled.update(v => !v);
        setSetting('chat:indexMode', this.indexEnabled());
        console.log('[AiChatPanel] Index mode:', this.indexEnabled() ? 'ON' : 'OFF');
    }

    toggleSystemPrompt(): void {
        this.showSystemPrompt.update(v => !v);
    }

    resetSystemPrompt(): void {
        this.systemPromptInput.set(KAMMI_SYSTEM_PROMPT);
    }

    // -------------------------------------------------------------------------
    // Model Management
    // -------------------------------------------------------------------------

    private loadSavedModels(): string[] {
        const stored = getSetting<string[] | null>(this.MODELS_KEY, null);
        if (stored && stored.length > 0) return stored;
        // First run — persist seeds
        setSetting(this.MODELS_KEY, this.MODEL_SEEDS);
        return [...this.MODEL_SEEDS];
    }

    addCustomModel(): void {
        const id = this.customModelInput().trim();
        if (!id) return;
        const current = this.savedModels();
        if (current.includes(id)) {
            // Just select it if already present
            this.selectedModel.set(id);
            this.customModelInput.set('');
            return;
        }
        const updated = [id, ...current]; // Prepend so new models appear first
        this.savedModels.set(updated);
        setSetting(this.MODELS_KEY, updated);
        this.selectedModel.set(id);
        this.customModelInput.set('');
    }

    removeModel(id: string): void {
        const updated = this.savedModels().filter(m => m !== id);
        this.savedModels.set(updated);
        setSetting(this.MODELS_KEY, updated);
        // If the removed model was selected, fall back to first in list
        if (this.selectedModel() === id) {
            this.selectedModel.set(updated[0] ?? '');
        }
    }

    // -------------------------------------------------------------------------
    // History Panel
    // -------------------------------------------------------------------------

    openHistory(): void {
        this.loadSessions();
        this.showHistory.set(true);
    }

    private loadSessions(): void {
        // Get thread list from Go WASM
        const threads = this.goChatService.threads();

        // Build session info from threads
        const sessions: SessionInfo[] = threads.map((thread: Thread) => {
            return {
                id: thread.id,
                messageCount: 0, // Would require additional query
                createdAt: thread.created_at,
                preview: thread.title || undefined,
            };
        });

        this.sessions.set(sessions);
    }

    async selectSession(sessionId: string): Promise<void> {
        await this.goChatService.loadThread(sessionId);
        this.showHistory.set(false);
        this.currentTraceMsgId = null;
        this.activitySteps.set([]);

        // Reload chat with new session messages
        this.reloadChatFromService();
    }

    private reloadChatFromService(): void {
        if (!this.chat) return;

        // Clear current chat - reinitialize to fully reset
        this.chatContainer.nativeElement.innerHTML = '';
        this.initializeChat();
    }

    formatSessionDate(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        // Less than 1 day
        if (diff < 86400000) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        // Less than 7 days
        if (diff < 604800000) {
            return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        }
        // Older
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // -------------------------------------------------------------------------
    // QuikChat Setup
    // -------------------------------------------------------------------------

    private async loadQuikChat(): Promise<void> {
        if ((window as any).quikchat) {
            this.initializeChat();
            return;
        }

        // NOTE: Not loading quikchat CSS - we style everything ourselves
        // This gives us full control over the appearance

        // Load JS
        if (!this.scriptLoaded) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/quikchat';
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                this.scriptLoaded = true;
                this.initializeChat();
            };
            script.onerror = () => {
                console.error('[AiChatPanel] Failed to load quikchat');
            };
            document.body.appendChild(script);
        }
    }

    private initializeChat(): void {
        const container = this.chatContainer.nativeElement;

        this.chat = new (window as any).quikchat(container, (instance: any, message: string) => {
            this.onUserMessage(instance, message);
        }, {
            placeholder: 'Ask Kammi anything...',
            sendButtonText: '→',
        });

        this.applyChatInputAccessibilityFix(container);

        // Restore history
        this.restoreHistory();

        // Welcome message if empty
        if (this.goChatService.messageCount() === 0) {
            this.chat.messageAddNew(
                'Hello! I\'m Kammi, your AI assistant. How can I help you with your world-building today? ✨',
                'Kammi',
                'left'
            );
        }
    }

    private applyChatInputAccessibilityFix(container: HTMLElement): void {
        requestAnimationFrame(() => {
            const input = container.querySelector<HTMLInputElement>('input.input-area');
            if (!input) return;

            if (!input.id) {
                input.id = 'kammi-chat-input';
            }
            if (!input.name) {
                input.name = 'kammi-chat-input';
            }
            if (!input.getAttribute('aria-label')) {
                input.setAttribute('aria-label', 'Ask Kammi anything');
            }

            const existingLabel = container.querySelector(`label[for="${input.id}"][data-kammi-chat-label="true"]`);
            if (existingLabel) return;

            const label = document.createElement('label');
            label.htmlFor = input.id;
            label.textContent = 'Ask Kammi anything';
            label.setAttribute('data-kammi-chat-label', 'true');
            label.style.position = 'absolute';
            label.style.width = '1px';
            label.style.height = '1px';
            label.style.padding = '0';
            label.style.margin = '-1px';
            label.style.overflow = 'hidden';
            label.style.clip = 'rect(0, 0, 0, 0)';
            label.style.whiteSpace = 'nowrap';
            label.style.border = '0';
            input.parentElement?.insertBefore(label, input);
        });
    }

    private restoreHistory(): void {
        const messages = this.goChatService.messages();
        for (const msg of messages) {
            const side = msg.role === 'user' ? 'right' : 'left';
            const sender = msg.role === 'user' ? 'You' : 'Kammi';
            this.chat.messageAddNew(msg.content, sender, side);
        }
    }

    // -------------------------------------------------------------------------
    // Message Handling
    // -------------------------------------------------------------------------

    private async onUserMessage(instance: any, text: string): Promise<void> {
        if (!text.trim()) return;

        instance.messageAddNew(text, 'You', 'right');
        await this.goChatService.addUserMessage(text);

        const thinkingStepId = this.startActivityTrace(instance);

        const googleConfigured = this.googleGenAI.isConfigured();
        const openRouterConfigured = this.isGoConfigured();

        if (!googleConfigured && !openRouterConfigured) {
            this.finishActivityStep(thinkingStepId, 'error', 'AI provider is not configured.');
            instance.messageAddNew(
                '[Warning] Please configure an API key in settings (gear icon) to enable AI responses.',
                'Kammi',
                'left'
            );
            return;
        }

        let contextBlock = '';
        let activation: ActivationResult | null = null;

        if (this.indexEnabled()) {
            const indexStepId = this.addActivityStep('tool', 'Reading notes', 'Searching the workspace for note context...');
            try {
                const threadId = this.goChatService.currentThread()?.id || 'default';
                contextBlock = await this.orchestrator.orchestrate(text, threadId);
                activation = this.orchestrator.lastActivation();
                this.mapActivationToActivity(indexStepId, activation, contextBlock);
            } catch (err) {
                console.error('[AiChatPanel] Orchestrator error:', err);
                this.finishActivityStep(indexStepId, 'error', this.toErrorMessage(err));
            }
        }

        const highlightedClips = this.chatContextClipStore.consumeAll();
        const highlightedContext = this.chatContextClipStore.formatForPrompt(highlightedClips);
        if (highlightedClips.length > 0) {
            this.addCompletedStep(
                'tool',
                highlightedClips.length === 1 ? 'Using highlighted text' : `Using ${highlightedClips.length} highlighted passages`,
                'Injected highlighted note snippets into this turn.'
            );
        }

        const history = this.buildConversationHistory();
        const effectiveSystemPrompt = this.systemPromptInput()
            + (contextBlock ? '\n\n' + contextBlock : '')
            + (highlightedContext ? '\n\n' + highlightedContext : '');
        const thinkingSummary = this.buildThinkingSummary(contextBlock, highlightedClips.length, activation);
        const reasoningStepId = this.activeProvider() === 'go-openrouter' && this.reasoningEnabledInput()
            ? this.addActivityStep('reasoning', 'Reasoning', 'Waiting for model reasoning...')
            : null;
        this.finishActivityStep(thinkingStepId, 'done', thinkingSummary);

        const botMsgId = instance.messageAddNew('', 'Kammi', 'left');
        this.currentBotMsgId = botMsgId;

        const streamStepId = this.addActivityStep('stream', 'Responding', 'Writing the answer...');
        await this.handleStreamingChat(
            instance,
            botMsgId,
            history,
            effectiveSystemPrompt,
            (event) => {
                this.applyProgressEvent(streamStepId, event);
            },
            reasoningStepId ? (chunk) => this.appendActivityStepDetail(reasoningStepId, chunk) : undefined
        );
        if (reasoningStepId) {
            this.finalizeReasoningStep(reasoningStepId);
        }
    }

    private async handleStreamingChat(
        instance: any,
        botMsgId: string,
        history: OpenRouterMessage[],
        systemPrompt: string,
        onEvent?: (event: ChatProgressEvent) => void,
        onReasoningChunk?: (chunk: string) => void
    ): Promise<void> {
        if (this.activeProvider() === 'google' && this.googleGenAI.isConfigured()) {
            const googleHistory: GoogleGenAIMessage[] = history
                .filter(msg => msg.role !== 'system')
                .map(msg => ({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content || '' }]
                }));

            onEvent?.({ stage: 'stream', status: 'running', detail: 'Generating answer...' });
            await this.googleGenAI.streamChat(googleHistory, {
                onChunk: (chunk) => instance.messageAppendContent(botMsgId, chunk),
                onComplete: async (response) => {
                    await this.goChatService.addAssistantMessage(response);
                    this.currentBotMsgId = null;
                    onEvent?.({ stage: 'stream', status: 'done', detail: 'Answer complete.' });
                },
                onError: (error) => {
                    console.error('[AiChatPanel] Google GenAI error:', error);
                    instance.messageReplaceContent(botMsgId, `Error: ${error.message}`);
                    this.currentBotMsgId = null;
                    onEvent?.({ stage: 'stream', status: 'error', detail: error.message });
                },
            }, systemPrompt);
        } else {
            await this.goChatService.streamChat(history, {
                onChunk: (chunk) => instance.messageAppendContent(botMsgId, chunk),
                onReasoningChunk,
                onComplete: async (response) => {
                    await this.goChatService.addAssistantMessage(response);
                    this.currentBotMsgId = null;
                },
                onError: (error) => {
                    console.error('[AiChatPanel] Go stream error:', error);
                    instance.messageReplaceContent(botMsgId, `Error from Go: ${error.message}`);
                    this.currentBotMsgId = null;
                },
                onEvent,
            }, systemPrompt);
        }
    }

    private buildConversationHistory(): OpenRouterMessage[] {
        return this.goChatService.messages()
            .slice(-10)
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    private startActivityTrace(instance: any): string {
        this.traceCounter = 0;
        this.traceStartedAt.clear();
        this.activitySteps.set([]);
        this.currentTraceMsgId = instance.messageAddNew(this.renderActivityTraceMarkup(), 'Kammi', 'left');
        return this.addActivityStep(
            'reasoning',
            'Thinking',
            this.reasoningEnabledInput() && this.activeProvider() === 'go-openrouter'
                ? 'Reasoning through your request...'
                : 'Reading your request...'
        );
    }

    private addActivityStep(
        kind: ActivityTraceStep['kind'],
        label: string,
        detail?: string
    ): string {
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
        id: string,
        status: ActivityTraceStep['status'],
        detail?: string,
        latencyMs?: number
    ): void {
        const startedAt = this.traceStartedAt.get(id);
        const measuredLatency = latencyMs ?? (startedAt ? Date.now() - startedAt : undefined);
        this.traceStartedAt.delete(id);

        this.activitySteps.update((steps) =>
            steps.map((step) => {
                if (step.id !== id) return step;
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
                if (step.id !== stepId) return step;
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
        const step = this.activitySteps().find((item) => item.id === stepId);
        if (!step) return;
        const detail = step.detail === 'Waiting for model reasoning...'
            ? 'Reasoning was enabled, but the model did not return reasoning tokens.'
            : step.detail;
        this.finishActivityStep(stepId, 'done', detail);
    }
    private applyProgressEvent(stepId: string, event: ChatProgressEvent): void {
        if (event.status === 'running') {
            this.activitySteps.update((steps) =>
                steps.map((step) => {
                    if (step.id !== stepId) return step;
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

    private mapActivationToActivity(
        indexStepId: string,
        activation: ActivationResult | null,
        contextBlock: string
    ): void {
        if (!activation) {
            this.finishActivityStep(indexStepId, 'done', contextBlock ? 'Relevant note context was found.' : 'Workspace check complete.');
            return;
        }

        if (activation.error) {
            this.finishActivityStep(indexStepId, 'error', activation.error);
            return;
        }

        if (!activation.triggered) {
            this.finishActivityStep(indexStepId, 'done', activation.miss_reason || 'No extra note context was needed.');
            return;
        }

        const summary = activation.summary
            || activation.miss_reason
            || (contextBlock ? 'Relevant note context was injected.' : 'Context was injected from index mode.');

        this.finishActivityStep(indexStepId, 'done', summary);

        for (const call of activation.tool_calls || []) {
            this.addCompletedStep(
                'tool',
                `Tool: ${this.prettyToolName(call.tool)}` ,
                call.ok ? 'Completed successfully.' : (call.error || 'Tool failed.'),
                call.ok ? 'done' : 'error',
                call.lat_ms
            );
        }
    }

    private buildThinkingSummary(
        contextBlock: string,
        highlightedCount: number,
        activation: ActivationResult | null
    ): string {
        const parts: string[] = [];

        if (contextBlock || activation?.triggered) {
            parts.push('used note context');
        }

        if (highlightedCount > 0) {
            parts.push(highlightedCount === 1 ? 'included highlighted text' : `included ${highlightedCount} highlighted passages`);
        }

        const toolCount = activation?.tool_calls?.length ?? 0;
        if (toolCount > 0) {
            parts.push(toolCount === 1 ? 'ran 1 tool' : `ran ${toolCount} tools`);
        }

        if (parts.length === 0) {
            return 'Ready to answer.';
        }

        const sentence = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        return parts.length === 1 ? `${sentence}.` : `${sentence} and ${parts.slice(1).join(' and ')}.`;
    }

    private syncActivityTrace(): void {
        if (!this.chat || this.currentTraceMsgId === null) return;
        this.chat.messageReplaceContent(this.currentTraceMsgId, this.renderActivityTraceMarkup());
    }

    private renderActivityTraceMarkup(): string {
        const steps = this.activitySteps();
        const statusText = this.getActivityStatusText();
        const stepMarkup = steps.map((step) => {
            const detail = step.detail ? `<div class="inline-trace-step-detail">${this.escapeHtml(step.detail)}</div>` : '';
            const latency = step.latencyMs !== undefined ? `<span class="inline-trace-step-latency">${step.latencyMs}ms</span>` : '';
            return [
                `<div class="inline-trace-step ${step.status}">`,
                '<div class="inline-trace-dot"></div>',
                '<div>',
                `<div class="inline-trace-step-title">${this.escapeHtml(step.label)}</div>`,
                detail,
                '</div>',
                latency,
                '</div>'
            ].join('');
        }).join('');

        return [
            '<div class="inline-trace">',
            '<div class="inline-trace-header">',
            '<div class="inline-trace-title"><span class="brain-mark">*</span><span>Thinking</span></div>',
            `<div class="inline-trace-status">${this.escapeHtml(statusText)}</div>`,
            '</div>',
            `<div class="inline-trace-steps">${stepMarkup}</div>`,
            '</div>'
        ].join('');
    }

    private getActivityStatusText(): string {
        const steps = this.activitySteps();
        if (steps.length === 0) return 'Starting';

        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].status === 'running') return steps[i].label;
        }

        return steps.some((step) => step.status === 'error') ? 'Completed with issues' : 'Done';
    }

    private prettyToolName(name: string): string {
        return name
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, (m) => m.toUpperCase());
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private toErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    // -------------------------------------------------------------------------
    // Public Actions
    // -------------------------------------------------------------------------

    async newSession(): Promise<void> {
        await this.goChatService.newSession();
        this.currentTraceMsgId = null;
        this.activitySteps.set([]);
        if (this.chat) {
            this.chatContainer.nativeElement.innerHTML = '';
            this.initializeChat();
        }
    }

    async clearChat(): Promise<void> {
        await this.goChatService.clearThread();
        this.currentTraceMsgId = null;
        this.activitySteps.set([]);
        if (this.chat) {
            this.chatContainer.nativeElement.innerHTML = '';
            this.initializeChat();
        }
    }

    async exportChat(): Promise<void> {
        const json = await this.goChatService.exportThread();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const threadId = this.goChatService.currentThread()?.id || 'unknown';
        a.download = `chat-${threadId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}







