/**
 * AI Chat Panel Component
 * 
 * Wraps quikchat vanilla JS library with Angular integration.
 * Uses GoChatService for Go/SQLite persistence + memory extraction.
 * Uses OpenRouter/GoogleGenAI for LLM streaming.
 * 
 * Architecture:
 * - GoChatService: Persistence, memory extraction, thread management (Go WASM)
 * - OpenRouterService/GoogleGenAIService: Live LLM streaming (TypeScript)
 */

import {
    Component,
    inject,
    AfterViewInit,
    OnDestroy,
    ElementRef,
    ViewChild,
    signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Trash2, Download, Plus, Settings, Send, History, ArrowLeft, Database, Brain } from 'lucide-angular';
import { GoChatService, type Thread, type ThreadMessage } from '../../../lib/services/go-chat.service';
import { GoOMService } from '../../../services/go-om.service';
import { OpenRouterService, OpenRouterMessage, ToolCallResponse } from '../../../lib/services/openrouter.service';
import { GoogleGenAIService, GoogleGenAIMessage } from '../../../lib/services/google-genai.service';
import { GoKittService } from '../../../services/gokitt.service';
import { ALL_TOOLS, type ToolExecutionContext, executeToolCalls, type ToolCall } from '../../../lib/ai';
import { EditorAgentBridge } from '../../../lib/ai/editor-agent-bridge';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';

// Import quikchat (vanilla JS lib)
declare const quikchat: any;

interface SessionInfo {
    id: string;
    messageCount: number;
    createdAt: number;
    preview?: string;
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
                        [class.text-teal-400]="openRouter.isConfigured()"
                        [class.text-amber-400]="!openRouter.isConfigured()"
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
                            [class.bg-teal-600]="activeProvider() === 'openrouter'"
                            [class.text-white]="activeProvider() === 'openrouter'"
                            [class.text-muted-foreground]="activeProvider() !== 'openrouter'"
                            (click)="activeProvider.set('openrouter')">
                            OpenRouter
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

                    <!-- OpenRouter Settings -->
                    @if (activeProvider() === 'openrouter') {
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
                        <div class="space-y-1">
                            <label class="text-xs font-medium text-muted-foreground">Model</label>
                            <select 
                                class="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-teal-500"
                                [value]="selectedModel()"
                                (change)="selectedModel.set($any($event.target).value)"
                            >
                                @for (model of openRouter.popularModels; track model.id) {
                                    <option [value]="model.id">{{ model.name }} ({{ model.provider }})</option>
                                }
                            </select>
                        </div>
                        @if (!openRouter.isConfigured()) {
                            <p class="text-xs text-amber-400">
                                ⚠️ Get your API key at <a href="https://openrouter.ai/keys" target="_blank" class="underline">openrouter.ai/keys</a>
                            </p>
                        }
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

                    <!-- Observational Memory Toggle -->
                    <div class="border-t border-border/30 pt-2 mt-2">
                        <div class="flex items-center justify-between py-1">
                            <div class="flex items-center gap-2">
                                <lucide-icon [img]="BrainIcon" class="h-4 w-4 text-muted-foreground"></lucide-icon>
                                <div>
                                    <label class="text-xs font-medium">Observational Memory</label>
                                    <p class="text-[10px] text-muted-foreground">AI remembers conversation context</p>
                                </div>
                            </div>
                            <button
                                class="relative w-11 h-6 rounded-full transition-colors"
                                [class.bg-teal-600]="omEnabled()"
                                [class.bg-muted]="!omEnabled()"
                                (click)="toggleOM()"
                            >
                                <span
                                    class="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                                    [class.translate-x-5]="omEnabled()"
                                ></span>
                            </button>
                        </div>
                        @if (omEnabled()) {
                            <div class="grid grid-cols-2 gap-2 mt-2 pl-6">
                                <div class="space-y-1">
                                    <label class="text-[10px] text-muted-foreground">Observe Threshold</label>
                                    <input
                                        type="number"
                                        class="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                                        [value]="omObserveThreshold()"
                                        (input)="omObserveThreshold.set($any($event.target).valueAsNumber || 1000)"
                                        min="500"
                                        max="5000"
                                        step="100"
                                    />
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[10px] text-muted-foreground">Reflect Threshold</label>
                                    <input
                                        type="number"
                                        class="w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                                        [value]="omReflectThreshold()"
                                        (input)="omReflectThreshold.set($any($event.target).valueAsNumber || 4000)"
                                        min="2000"
                                        max="10000"
                                        step="500"
                                    />
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
                    @if (googleGenAI.isConfigured() || openRouter.isConfigured()) {
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

    // GoChatService for persistence + memory (Go WASM)
    goChatService = inject(GoChatService);
    // Streaming services (TypeScript)
    openRouter = inject(OpenRouterService);
    googleGenAI = inject(GoogleGenAIService);
    private goKittService = inject(GoKittService);
    private noteEditorStore = inject(NoteEditorStore);
    editorBridge = inject(EditorAgentBridge);
    // Track Go batch init for agentic chat
    private goBatchInitialized = false;
    // Track Go chat init
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

    // Settings panel state
    showSettings = signal(false);
    activeProvider = signal<'google' | 'openrouter'>('google');  // Default to Google

    // OpenRouter settings
    apiKeyInput = signal('');
    selectedModel = signal('nvidia/nemotron-3-nano-30b-a3b:free');

    // Google GenAI settings
    googleApiKeyInput = signal('');
    googleModelInput = signal('gemini-3-flash-preview');

    // Index toggle - enables tool calling
    indexEnabled = signal(false);

    // Observational Memory settings
    omService = inject(GoOMService);
    omEnabled = signal(true);
    omObserveThreshold = signal(1000);
    omReflectThreshold = signal(4000);

    // History panel state
    showHistory = signal(false);
    sessions = signal<SessionInfo[]>([]);

    // Current streaming message ID
    private currentBotMsgId: string | null = null;
    private chat: any = null;
    private scriptLoaded = false;

    ngAfterViewInit(): void {
        this.loadQuikChat();

        // Pre-fill settings from saved configs
        const orConfig = this.openRouter.config();
        if (orConfig) {
            this.apiKeyInput.set(orConfig.apiKey || '');
            this.selectedModel.set(orConfig.model || 'nvidia/nemotron-3-nano-30b-a3b:free');
        }

        const googleConfig = this.googleGenAI.config();
        if (googleConfig) {
            this.googleApiKeyInput.set(googleConfig.apiKey || '');
            this.googleModelInput.set(googleConfig.model || 'gemini-2.0-flash');
        }

        // Set active provider based on which is configured
        if (this.googleGenAI.isConfigured()) {
            this.activeProvider.set('google');
        } else if (this.openRouter.isConfigured()) {
            this.activeProvider.set('openrouter');
        }

        // Initialize Go chat service
        this.initGoChatService();
    }

    /**
     * Initialize Go chat service with OpenRouter config.
     * This enables persistence + memory extraction.
     */
    private async initGoChatService(): Promise<void> {
        if (this.goChatInitialized) return;

        const orConfig = this.openRouter.config();
        if (orConfig?.apiKey) {
            await this.goChatService.init({
                apiKey: orConfig.apiKey,
                model: orConfig.model || 'meta-llama/llama-3.3-70b-instruct:free'
            });
            this.goChatInitialized = true;
            console.log('[AiChatPanel] Go chat service initialized');
        }
    }

    ngOnDestroy(): void {
        this.chat = null;
    }

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------

    toggleSettings(): void {
        this.showSettings.update(v => !v);
    }

    saveSettings(): void {
        // Save OpenRouter config
        if (this.apiKeyInput()) {
            this.openRouter.saveConfig({
                apiKey: this.apiKeyInput(),
                model: this.selectedModel(),
                temperature: 0.7,
                maxTokens: 2048,
                systemPrompt: KAMMI_SYSTEM_PROMPT,
            });
        }

        // Save Google GenAI config
        if (this.googleApiKeyInput()) {
            this.googleGenAI.saveConfig({
                apiKey: this.googleApiKeyInput(),
                model: this.googleModelInput(),
                temperature: 0.7,
                maxOutputTokens: 2048,
                systemPrompt: KAMMI_SYSTEM_PROMPT,
            });
        }

        // Save OM settings
        this.saveOMSettings();

        console.log('[AiChatPanel] Settings saved, active provider:', this.activeProvider());
        this.showSettings.set(false);
    }

    getActiveProviderName(): string {
        if (this.googleGenAI.isConfigured() && this.activeProvider() === 'google') {
            return `Google Gemini (${this.googleGenAI.getModel()})`;
        } else if (this.openRouter.isConfigured()) {
            return `OpenRouter (${this.openRouter.getModel().split('/').pop()})`;
        }
        return 'Not configured';
    }

    toggleIndexMode(): void {
        this.indexEnabled.update(v => !v);
        console.log('[AiChatPanel] Index mode:', this.indexEnabled() ? 'ON' : 'OFF');
    }

    toggleOM(): void {
        this.omEnabled.update(v => !v);
        this.omService.updateConfig({ enabled: this.omEnabled() });
        console.log('[AiChatPanel] Observational Memory:', this.omEnabled() ? 'ON' : 'OFF');
    }

    saveOMSettings(): void {
        this.omService.updateConfig({
            enabled: this.omEnabled(),
            observeThreshold: this.omObserveThreshold(),
            reflectThreshold: this.omReflectThreshold(),
        });
        console.log('[AiChatPanel] OM settings saved:', {
            enabled: this.omEnabled(),
            observeThreshold: this.omObserveThreshold(),
            reflectThreshold: this.omReflectThreshold(),
        });
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

        // Add user message to UI and persist via Go
        instance.messageAddNew(text, 'You', 'right');
        await this.goChatService.addUserMessage(text);

        // Check if any provider is configured
        const googleConfigured = this.googleGenAI.isConfigured();
        const openRouterConfigured = this.openRouter.isConfigured();

        if (!googleConfigured && !openRouterConfigured) {
            instance.messageAddNew(
                '⚠️ Please configure an API key in settings (gear icon) to enable AI responses.',
                'Kammi',
                'left'
            );
            return;
        }

        // Create empty bot message for streaming
        const botMsgId = instance.messageAddNew('', 'Kammi', 'left');
        this.currentBotMsgId = botMsgId;

        // Build conversation history for context
        const history = this.buildConversationHistory(text);

        // If Index mode is enabled, use agentic tool calling (OpenRouter only for now)
        if (this.indexEnabled() && openRouterConfigured) {
            await this.handleAgenticChat(instance, botMsgId, history);
        } else {
            // Standard streaming - use active provider
            await this.handleStreamingChat(instance, botMsgId, history);
        }
    }

    private async handleStreamingChat(
        instance: any,
        botMsgId: string,
        history: OpenRouterMessage[]
    ): Promise<void> {
        let fullResponse = '';

        // Determine which provider to use
        const useGoogle = this.activeProvider() === 'google' && this.googleGenAI.isConfigured();

        if (useGoogle) {
            // Convert to Google GenAI message format
            const googleHistory: GoogleGenAIMessage[] = history
                .filter(msg => msg.role !== 'system') // System handled separately
                .map(msg => ({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content || '' }]
                }));

            await this.googleGenAI.streamChat(googleHistory, {
                onChunk: (chunk) => {
                    fullResponse += chunk;
                    instance.messageAppendContent(botMsgId, chunk);
                },
                onComplete: async (response) => {
                    await this.goChatService.addAssistantMessage(response);
                    this.currentBotMsgId = null;
                },
                onError: (error) => {
                    console.error('[AiChatPanel] Google GenAI error:', error);
                    instance.messageReplaceContent(botMsgId, `❌ Error: ${error.message}`);
                    this.currentBotMsgId = null;
                },
            }, KAMMI_SYSTEM_PROMPT);
        } else {
            // Use OpenRouter
            await this.openRouter.streamChat(history, {
                onChunk: (chunk) => {
                    fullResponse += chunk;
                    instance.messageAppendContent(botMsgId, chunk);
                },
                onComplete: async (response) => {
                    await this.goChatService.addAssistantMessage(response);
                    this.currentBotMsgId = null;
                },
                onError: (error) => {
                    console.error('[AiChatPanel] OpenRouter error:', error);
                    instance.messageReplaceContent(botMsgId, `❌ Error: ${error.message}`);
                    this.currentBotMsgId = null;
                },
            }, KAMMI_SYSTEM_PROMPT);
        }
    }

    private async handleAgenticChat(
        instance: any,
        botMsgId: string,
        history: OpenRouterMessage[]
    ): Promise<void> {
        const MAX_ITERATIONS = 5;
        let iterations = 0;
        let messages = [...history];

        // Build tool execution context
        const toolContext: ToolExecutionContext = {
            goKittService: this.goKittService,
            editorBridge: this.editorBridge,
            getCurrentNoteContent: () => {
                const note = this.noteEditorStore.currentNote();
                if (!note?.content) return null;
                try {
                    // content is JSON string, parse and extract text
                    const json = JSON.parse(note.content);
                    return note.markdownContent || JSON.stringify(json);
                } catch {
                    return note.markdownContent || null;
                }
            },
            getCurrentNoteId: () => this.noteEditorStore.activeNoteId() || null,
            getCurrentNoteTitle: () => {
                const note = this.noteEditorStore.currentNote();
                return note?.title || null;
            }
        };

        instance.messageAppendContent(botMsgId, '🔍 ');

        try {
            while (iterations < MAX_ITERATIONS) {
                iterations++;
                console.log(`[AiChatPanel] Agentic loop iteration ${iterations}`);

                // Initialize Go batch with OpenRouter config on first call
                if (!this.goBatchInitialized) {
                    const orConfig = this.openRouter.config();
                    if (orConfig?.apiKey) {
                        const initResult = await this.goKittService.batchInit({
                            provider: 'openrouter',
                            openRouterApiKey: orConfig.apiKey,
                            openRouterModel: orConfig.model || 'meta-llama/llama-3.3-70b-instruct:free'
                        });
                        if (initResult.success) {
                            this.goBatchInitialized = true;
                            console.log('[AiChatPanel] Go batch initialized for agent:', initResult.provider, initResult.model);
                        } else {
                            throw new Error(`Go batch init failed: ${initResult.error}`);
                        }
                    }
                }

                // Use Go WASM for non-streaming tool-calling completion
                const result = await this.goKittService.agentChatWithTools(
                    messages,
                    ALL_TOOLS,
                    KAMMI_SYSTEM_PROMPT
                );

                // If model returned content, we're done
                if (result.content && !result.tool_calls?.length) {
                    instance.messageReplaceContent(botMsgId, result.content);
                    await this.goChatService.addAssistantMessage(result.content);
                    this.currentBotMsgId = null;
                    return;
                }

                // If model wants to call tools
                if (result.tool_calls && result.tool_calls.length > 0) {
                    // Show tool usage indicator
                    const toolNames = result.tool_calls.map(tc => tc.function.name).join(', ');
                    instance.messageAppendContent(botMsgId, `📎 ${toolNames}... `);

                    // Add assistant message with tool_calls
                    messages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: result.tool_calls
                    });

                    // Execute tools
                    const toolCalls = result.tool_calls as ToolCall[];
                    const toolResults = await executeToolCalls(toolCalls, toolContext);

                    // Add tool results to conversation
                    for (const toolResult of toolResults) {
                        messages.push({
                            role: 'tool',
                            content: toolResult.content,
                            tool_call_id: toolResult.tool_call_id
                        });
                    }

                    // Continue loop
                    continue;
                }

                // Edge case: no content and no tool calls
                instance.messageReplaceContent(botMsgId, 'I couldn\'t generate a response. Try rephrasing your question.');
                this.currentBotMsgId = null;
                return;
            }

            // Max iterations reached
            instance.messageReplaceContent(botMsgId, '⚠️ Reached maximum tool iterations. Try a simpler question.');
            this.currentBotMsgId = null;

        } catch (err) {
            console.error('[AiChatPanel] Agentic chat error:', err);
            instance.messageReplaceContent(botMsgId, `❌ Error: ${err instanceof Error ? err.message : String(err)}`);
            this.currentBotMsgId = null;
        }
    }

    private buildConversationHistory(currentMessage: string): OpenRouterMessage[] {
        const messages: OpenRouterMessage[] = [];

        // Add recent conversation history (last 10 messages for context)
        const history = this.goChatService.messages().slice(-10);
        for (const msg of history) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({
                    role: msg.role,
                    content: msg.content,
                });
            }
        }

        // Add current message
        messages.push({
            role: 'user',
            content: currentMessage,
        });

        return messages;
    }

    // -------------------------------------------------------------------------
    // Public Actions
    // -------------------------------------------------------------------------

    async newSession(): Promise<void> {
        await this.goChatService.newSession();
        if (this.chat) {
            this.chatContainer.nativeElement.innerHTML = '';
            this.initializeChat();
        }
    }

    async clearChat(): Promise<void> {
        await this.goChatService.clearThread();
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
