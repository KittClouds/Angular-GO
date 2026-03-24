import { Injectable, inject } from '@angular/core';
import { EditorAgentWorkspaceService } from './editor-agent-workspace.service';
import type { ChatApprovalRequest, ChatToolCall, ToolProposal, ToolResultSubmission } from './phoenix-chat.service';

@Injectable({ providedIn: 'root' })
export class ChatToolHostService {
    private readonly workspace = inject(EditorAgentWorkspaceService);

    async executeCall(call: ChatToolCall): Promise<ToolResultSubmission> {
        try {
            const args = this.parseArgs(call.argumentsJson);
            switch (call.toolName) {
                case 'get_active_note_snapshot': {
                    const snapshot = this.workspace.getSnapshot();
                    if (!snapshot) return { callId: call.id, error: 'No active note/editor snapshot available.' };
                    return { callId: call.id, toolCallId: call.toolCallId, resultJson: JSON.stringify(snapshot) };
                }
                case 'get_selection': {
                    const selection = this.workspace.getSelection();
                    if (!selection) return { callId: call.id, error: 'No active editor selection available.' };
                    return { callId: call.id, toolCallId: call.toolCallId, resultJson: JSON.stringify(selection) };
                }
                case 'replace_text_proposal':
                    return this.buildReplaceTextProposal(call, args);
                case 'rewrite_block_proposal':
                    return this.buildRewriteBlockProposal(call, args);
                case 'insert_text_proposal':
                    return this.buildInsertTextProposal(call, args);
                case 'save_note_proposal':
                    return this.buildSaveNoteProposal(call);
                default:
                    return { callId: call.id, toolCallId: call.toolCallId, error: `Unsupported tool: ${call.toolName}` };
            }
        } catch (err) {
            return {
                callId: call.id,
                toolCallId: call.toolCallId,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async applyApproval(approval: ChatApprovalRequest, approved: boolean): Promise<string> {
        if (!approved) {
            return JSON.stringify({ approved: false, applied: false, reason: 'User rejected proposal.' });
        }

        const proposal = this.parseProposal(approval.proposalJson);
        if (!proposal?.payloadJson) {
            return JSON.stringify({ approved: true, applied: false, error: 'Missing proposal payload.' });
        }

        try {
            const payload = JSON.parse(proposal.payloadJson) as Record<string, any>;
            switch (approval.toolName) {
                case 'replace_text_proposal': {
                    const result = await this.workspace.replaceText(
                        Number(payload['from'] ?? 0),
                        Number(payload['to'] ?? 0),
                        String(payload['replacement'] ?? ''),
                        payload['expectedRevision'] ?? undefined
                    );
                    return JSON.stringify({ approved: true, applied: result.ok, ...result });
                }
                case 'rewrite_block_proposal': {
                    const result = await this.workspace.rewriteBlock(
                        Number(payload['blockIndex'] ?? -1),
                        String(payload['replacement'] ?? ''),
                        payload['expectedRevision'] ?? undefined
                    );
                    return JSON.stringify({ approved: true, applied: result.ok, ...result });
                }
                case 'insert_text_proposal': {
                    const result = await this.workspace.insertText(
                        Number(payload['pos'] ?? 0),
                        String(payload['text'] ?? ''),
                        payload['expectedRevision'] ?? undefined
                    );
                    return JSON.stringify({ approved: true, applied: result.ok, ...result });
                }
                case 'save_note_proposal': {
                    const result = await this.workspace.saveCurrentNote();
                    return JSON.stringify({ approved: true, applied: result.ok, ...result });
                }
                default:
                    return JSON.stringify({ approved: true, applied: false, error: `Unsupported proposal tool: ${approval.toolName}` });
            }
        } catch (err) {
            return JSON.stringify({
                approved: true,
                applied: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private buildReplaceTextProposal(call: ChatToolCall, args: Record<string, any>): ToolResultSubmission {
        const snapshot = this.workspace.getSnapshot();
        if (!snapshot) return { callId: call.id, error: 'No active note/editor snapshot available.' };

        const from = Number(args['from'] ?? 0);
        const to = Number(args['to'] ?? from);
        const replacement = String(args['replacement'] ?? '');
        const expectedRevision = args['expectedRevision'] ?? snapshot.revision;

        const diffPreview = `Replace text from ${from} to ${to} with:\n${replacement}`;
        const proposal: ToolProposal = {
            proposalId: this.generateId('proposal'),
            toolName: call.toolName,
            affectedNoteId: snapshot.noteId,
            summary: `Replace text in ${snapshot.noteTitle || 'active note'}`,
            diffPreview,
            expectedRevision,
            rollbackToken: `${snapshot.noteId}:${snapshot.revision}`,
            payloadJson: JSON.stringify({ kind: 'replace_text', from, to, replacement, expectedRevision }),
        };
        return { callId: call.id, toolCallId: call.toolCallId, proposal };
    }

    private buildRewriteBlockProposal(call: ChatToolCall, args: Record<string, any>): ToolResultSubmission {
        const snapshot = this.workspace.getSnapshot();
        if (!snapshot) return { callId: call.id, error: 'No active note/editor snapshot available.' };

        const blockIndex = Number(args['blockIndex'] ?? -1);
        const replacement = String(args['replacement'] ?? '');
        const expectedRevision = args['expectedRevision'] ?? snapshot.revision;
        const block = snapshot.blocks.find((item) => item.index === blockIndex);
        const diffPreview = `Block ${blockIndex}\nBefore: ${block?.text || '(missing)'}\nAfter: ${replacement}`;
        const proposal: ToolProposal = {
            proposalId: this.generateId('proposal'),
            toolName: call.toolName,
            affectedNoteId: snapshot.noteId,
            summary: `Rewrite block ${blockIndex} in ${snapshot.noteTitle || 'active note'}`,
            diffPreview,
            expectedRevision,
            rollbackToken: `${snapshot.noteId}:${snapshot.revision}`,
            payloadJson: JSON.stringify({ kind: 'rewrite_block', blockIndex, replacement, expectedRevision }),
        };
        return { callId: call.id, toolCallId: call.toolCallId, proposal };
    }

    private buildInsertTextProposal(call: ChatToolCall, args: Record<string, any>): ToolResultSubmission {
        const snapshot = this.workspace.getSnapshot();
        if (!snapshot) return { callId: call.id, error: 'No active note/editor snapshot available.' };

        const pos = Number(args['pos'] ?? 0);
        const text = String(args['text'] ?? '');
        const expectedRevision = args['expectedRevision'] ?? snapshot.revision;
        const diffPreview = `Insert at ${pos}:\n${text}`;
        const proposal: ToolProposal = {
            proposalId: this.generateId('proposal'),
            toolName: call.toolName,
            affectedNoteId: snapshot.noteId,
            summary: `Insert text into ${snapshot.noteTitle || 'active note'}`,
            diffPreview,
            expectedRevision,
            rollbackToken: `${snapshot.noteId}:${snapshot.revision}`,
            payloadJson: JSON.stringify({ kind: 'insert_text', pos, text, expectedRevision }),
        };
        return { callId: call.id, toolCallId: call.toolCallId, proposal };
    }

    private buildSaveNoteProposal(call: ChatToolCall): ToolResultSubmission {
        const snapshot = this.workspace.getSnapshot();
        if (!snapshot) return { callId: call.id, error: 'No active note/editor snapshot available.' };

        const proposal: ToolProposal = {
            proposalId: this.generateId('proposal'),
            toolName: call.toolName,
            affectedNoteId: snapshot.noteId,
            summary: `Save ${snapshot.noteTitle || 'active note'}`,
            diffPreview: 'Persist the current editor state to the note store.',
            expectedRevision: snapshot.revision,
            rollbackToken: `${snapshot.noteId}:${snapshot.revision}`,
            payloadJson: JSON.stringify({ kind: 'save_note', expectedRevision: snapshot.revision }),
        };
        return { callId: call.id, toolCallId: call.toolCallId, proposal };
    }

    private parseArgs(raw: string): Record<string, any> {
        if (!raw?.trim()) return {};
        try {
            return JSON.parse(raw) as Record<string, any>;
        } catch {
            return {};
        }
    }

    private parseProposal(raw?: string): ToolProposal | null {
        if (!raw?.trim()) return null;
        try {
            return JSON.parse(raw) as ToolProposal;
        } catch {
            return null;
        }
    }

    private generateId(prefix: string): string {
        return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    }
}
