import { Injectable } from '@angular/core';

export interface PhoenixScope {
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
}

export interface PhoenixChunkHit {
    chunkId: string;
    score: number;
}

export interface PhoenixNodeHit {
    entityId: string;
    score: number;
}

export interface PhoenixDiagnostic {
    code: string;
    message: string;
}

export interface PhoenixQueryBinaryResult {
    sessionId: string;
    chunkHits: PhoenixChunkHit[];
    nodeHits: PhoenixNodeHit[];
    diagnostics: PhoenixDiagnostic[];
}

export interface PhoenixGraphDeltaBinaryResult {
    sessionId: string;
    chunks: Array<{
        vertexId: string;
        chunkId: string;
        documentId: string;
        noteId?: string;
        chapterId: number;
        start: number;
        end: number;
    }>;
    nodes: Array<{
        nodeId: string;
        kind: string;
        label: string;
        entityId?: string;
        documentId?: string;
        chapterId?: number;
        weight: number;
    }>;
    edges: Array<{ sourceId: string; targetId: string; edgeType: string; weight: number }>;
    diagnostics: PhoenixDiagnostic[];
}

export interface PhoenixSessionStateBinaryResult {
    sessionId: string;
    documents: Array<{
        documentId: string;
        noteId?: string;
        chapterTitles: string[];
        chapterCount: number;
        parentCount: number;
        leafCount: number;
        entityCount: number;
        discoveryCount: number;
        hasFrontMatterChapter: boolean;
        updatedAt: number;
    }>;
    manifestNamespaces: string[];
}

export interface PhoenixSessionStatsBinaryResult {
    sessionId: string;
    documentCount: number;
    chapterCount: number;
    parentCount: number;
    leafCount: number;
    entityCount: number;
    discoveryCandidateCount: number;
    graphVertexCount: number;
    graphEdgeCount: number;
    spanCount: number;
    updatedAt: number;
}

export type PhoenixSnapshotPartition = 'all' | 'content' | 'derived';

export interface PhoenixOmPendingAction {
    kind: 'observe' | 'reflect';
    threadId: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    messageIds: string[];
    reflectorToolingEnabled: boolean;
    reflectorMaxToolRounds: number;
}

export interface PhoenixOmReflectorToolSpec {
    name: string;
    description: string;
    parametersJson: unknown;
}

export interface PhoenixOmReflectorToolCall {
    id: string;
    name: string;
    argumentsJson: string;
}

export interface PhoenixOmReflectorToolResult {
    toolCallId: string;
    name: string;
    resultJson: string;
}

export interface PhoenixOmReflectorMessage {
    role: string;
    content: string;
    name?: string | null;
    toolCallId?: string | null;
    toolCalls: PhoenixOmReflectorToolCall[];
}

export interface PhoenixOmReflectorModelRequest {
    sessionId: string;
    threadId: string;
    model: string;
    allowTools: boolean;
    tools: PhoenixOmReflectorToolSpec[];
    messages: PhoenixOmReflectorMessage[];
}

export interface PhoenixOmReflectorModelResponse {
    content: string;
    toolCalls: PhoenixOmReflectorToolCall[];
}

export type PhoenixOmReflectorStep =
    | { kind: 'modelRequest'; request: PhoenixOmReflectorModelRequest }
    | { kind: 'toolCalls'; sessionId: string; threadId: string; toolCalls: PhoenixOmReflectorToolCall[] }
    | { kind: 'complete'; sessionId: string; threadId: string; response: string };

export interface PhoenixOmTransportConfig {
    apiKey: string;
    defaultModel: string;
    omModel?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface PhoenixChatWorkspaceArtifact {
    key: string;
    runId: string;
    narrativeId: string;
    folderId: string;
    kind: string;
    payload: unknown;
    pinned: boolean;
    producedBy: string;
    createdAt: number;
    updatedAt: number;
}

export interface PhoenixChatPlannerToolSpec {
    name: string;
    description: string;
    parametersJson: unknown;
}

export interface PhoenixChatPlannerToolCall {
    id: string;
    name: string;
    argumentsJson: string;
}

export interface PhoenixChatPlannerMessage {
    role: string;
    content: string;
    name?: string | null;
    toolCallId?: string | null;
    toolCalls: PhoenixChatPlannerToolCall[];
}

export interface PhoenixChatPlannerModelRequest {
    runId: string;
    threadId: string;
    model: string;
    allowTools: boolean;
    tools: PhoenixChatPlannerToolSpec[];
    messages: PhoenixChatPlannerMessage[];
}

export interface PhoenixChatPlannerModelResponse {
    content: string;
    toolCalls: PhoenixChatPlannerToolCall[];
}

export type PhoenixChatPlannerStep =
    | { kind: 'modelRequest'; request: PhoenixChatPlannerModelRequest }
    | { kind: 'toolCalls'; runId: string; toolCalls: PhoenixChatPlannerToolCall[] }
    | { kind: 'complete'; runId: string; response: string };

export interface PhoenixChatPlannerTransportConfig {
    apiKey: string;
    defaultModel: string;
    temperature?: number;
    maxTokens?: number;
}

export type PhoenixChatStreamCallbacks = {
    onChunk: (chunk: string) => void;
    onComplete: (response: string) => void;
    onError: (error: Error) => void;
    onReasoningChunk?: (chunk: string) => void;
    onEvent?: (event: { stage: 'reasoning' | 'stream'; status: 'running' | 'done' | 'error'; detail?: string }) => void;
};

@Injectable({ providedIn: 'root' })
export class PhoenixWasmService {
    get isReady(): boolean {
        return false;
    }

    onReady(_callback: () => void): void {
        // WASM transport is intentionally unavailable on NewPhoenix.
    }

    async loadWasm(): Promise<void> {
        throw nativeOnlyError();
    }

    async initRuntime(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async createSession(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async ingest(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async query(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async commit(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async rebuild(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async scan(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async atlasRichScan(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async manifoldSnapshot(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async lorentzForestCache(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async lorentzForestBuild(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async lorentzForestQuery(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async buildStructure(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async analyzeText(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async graphDelta(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async sessionState(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async sessionStats(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async exportSnapshot(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async importSnapshot(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async storeCommand(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatInit(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatCreateThread(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatGetThread(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatListThreads(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatDeleteThread(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatAddMessage(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatListMessages(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatUpdateMessage(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatAppendMessage(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatStartStreamingMessage(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatClearThread(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatExportThread(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatStartRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatPollRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatResumeRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatCancelRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatListRunEvents(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatMarkRunStreaming(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatCompleteRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatGetPlannerStep(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatSubmitPlannerModelResponse(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatAdvancePlannerRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatDegradePlannerRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatListPlannerArtifacts(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatPinPlannerArtifact(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatPrepareOm(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatApplyOmAction(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatProcessOm(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatProcessPlannerRun(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatSubmitToolResults(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }
    async chatSubmitApproval(..._args: unknown[]): Promise<any> { throw nativeOnlyError(); }

    async streamChat(_request: unknown, callbacks: PhoenixChatStreamCallbacks): Promise<void> {
        callbacks.onError(nativeOnlyError());
    }
}

function nativeOnlyError(): Error {
    return new Error('Phoenix WASM transport was removed from NewPhoenix. Run through the Tauri native backend.');
}
