export type TaurpcChatCallbacks = {
    onChunk: (chunk: string) => void;
    onComplete: (response: string) => void;
    onError: (error: Error) => void;
    onReasoningChunk?: (chunk: string) => void;
    onEvent?: (event: { stage: 'reasoning' | 'stream'; status: 'running' | 'done' | 'error'; detail?: string }) => void;
};

export function toolCallingBody(request: any): Record<string, unknown> {
    return {
        messages: (request.messages ?? []).map((message: any) => ({
            role: message.role,
            content: message.content,
            ...(message.name ? { name: message.name } : {}),
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
            ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(toOpenRouterToolCall) } : {}),
        })),
        ...(request.allowTools ? { tools: (request.tools ?? []).map(toOpenRouterTool), tool_choice: 'auto' } : {}),
    };
}

export function modelResponse(payload: any): {
    content: string;
    toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
} {
    const choice = payload?.choices?.[0];
    const toolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
    return {
        content: extractText(choice?.message?.content) || extractText(choice?.content) || '',
        toolCalls: toolCalls.map((toolCall: any) => ({
            id: String(toolCall?.id || ''),
            name: String(toolCall?.function?.name || ''),
            argumentsJson: String(toolCall?.function?.arguments || '{}'),
        })),
    };
}

export async function fetchOpenRouter(model: string, config: any, body: Record<string, unknown>): Promise<any> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: openRouterHeaders(config),
        body: JSON.stringify({
            stream: false,
            temperature: typeof config.temperature === 'number' ? config.temperature : 0.3,
            max_tokens: typeof config.maxTokens === 'number' && config.maxTokens > 0 ? config.maxTokens : 2048,
            ...body,
            model,
        }),
    });
    if (!response.ok) {
        throw new Error(await response.text() || `OpenRouter request failed with status ${response.status}`);
    }
    return response.json();
}

export async function fetchOpenRouterStream(
    model: string,
    config: any,
    body: Record<string, unknown>,
    callbacks: TaurpcChatCallbacks,
): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: openRouterHeaders(config),
        body: JSON.stringify({
            ...body,
            model,
            stream: true,
            temperature: config.temperature ?? 0.7,
            max_tokens: config.maxTokens ?? 4096,
        }),
    });
    if (!response.ok) {
        throw new Error(await response.text() || `OpenRouter stream failed with status ${response.status}`);
    }
    callbacks.onEvent?.({ stage: 'stream', status: 'running' });
    const reader = response.body?.getReader();
    if (!reader) {
        const payload = await response.json();
        return extractText(payload?.choices?.[0]?.message?.content) || '';
    }
    return readOpenRouterSse(reader, callbacks);
}

export function responseFormat(value: any): unknown {
    if (!value?.enabled) {
        return undefined;
    }
    return value.type === 'json_schema'
        ? {
              type: 'json_schema',
              json_schema: {
                  name: value.name || 'phoenix_response',
                  strict: value.strict ?? true,
                  schema: value.schema,
              },
          }
        : { type: 'json_object' };
}

export function extractText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(extractText).join('');
    }
    return value && typeof value === 'object' && typeof (value as Record<string, unknown>)['text'] === 'string'
        ? String((value as Record<string, unknown>)['text'])
        : '';
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function safeParseObject(value: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

export function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' ? value : fallback;
}

export function stringOr(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function toOpenRouterTool(tool: any): any {
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parametersJson } };
}

function toOpenRouterToolCall(toolCall: any): any {
    return { id: toolCall.id, type: 'function', function: { name: toolCall.name, arguments: toolCall.argumentsJson } };
}

function openRouterHeaders(config: any): Record<string, string> {
    return {
        Authorization: `Bearer ${String(config.apiKey || '').trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'HTTP-Referer': globalThis.location?.origin || 'http://localhost',
        'X-Title': 'KittClouds Phoenix',
    };
}

async function readOpenRouterSse(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    callbacks: TaurpcChatCallbacks,
): Promise<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            callbacks.onEvent?.({ stage: 'stream', status: 'done' });
            return full;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) {
                continue;
            }
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') {
                continue;
            }
            const delta = JSON.parse(data)?.choices?.[0]?.delta;
            const reasoning = extractText(delta?.reasoning);
            const chunk = extractText(delta?.content);
            if (reasoning) {
                callbacks.onReasoningChunk?.(reasoning);
            }
            if (chunk) {
                full += chunk;
                callbacks.onChunk(chunk);
            }
        }
    }
}
