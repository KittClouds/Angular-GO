import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UI_API_SOURCE = readFileSync(
    resolve(process.cwd(), 'src', 'app', 'services', 'phoenix-ui-api.service.ts'),
    'utf8',
);

const STORE_SOURCE = readFileSync(
    resolve(process.cwd(), 'src', 'app', 'services', 'phoenix-store.service.ts'),
    'utf8',
);

const CHAT_SOURCE = readFileSync(
    resolve(process.cwd(), 'src', 'app', 'lib', 'services', 'phoenix-chat.service.ts'),
    'utf8',
);

function expectMethods(source: string, methods: string[]): void {
    for (const method of methods) {
        expect(source).toMatch(new RegExp(`\\b${method}(?:<[^>]+>)?\\s*\\(`));
    }
}

describe('Phoenix UI API contracts', () => {
    it('keeps the root Phoenix UI feature seams available', () => {
        expectMethods(UI_API_SOURCE, [
            'loadWasm',
            'hydrateWithEntities',
            'hydrateNotes',
            'upsertNote',
            'indexNote',
            'search',
            'searchScoped',
            'lineSearch',
            'scan',
            'scanDiscovery',
            'scanImplicitAsync',
            'analyzeText',
            'knowledgeInit',
            'knowledgeLoad',
            'knowledgeSync',
            'knowledgeSave',
            'knowledgeAddNode',
            'knowledgeAddEdge',
            'knowledgeGetGraph',
            'systemCreateSession',
            'systemIngest',
            'systemSearch',
            'systemCommit',
            'systemGetState',
            'systemGetStats',
            'systemRun',
        ]);
        expect(UI_API_SOURCE).not.toMatch(/\bgldr[A-Z]/);
    });

    it('keeps the Phoenix world persistence surface available', () => {
        expectMethods(STORE_SOURCE, [
            'initialize',
            'upsertNote',
            'listNotes',
            'upsertEntity',
            'listEntities',
            'upsertEdge',
            'listAllEdges',
            'upsertFolder',
            'listFolders',
            'upsertScopedDocument',
            'listScopedDocuments',
            'upsertScopedEntityField',
            'listScopedEntityFields',
            'upsertScopedDefinition',
            'listScopedDefinitions',
            'storeUpsertEntityCards',
            'storeGetEntityCards',
            'storeUpsertFolderSchema',
            'storeGetFolderSchema',
            'storeUpsertNetworkInstance',
            'storeGetNetworkMembers',
            'storeGetNetworkRelationships',
        ]);
    });

    it('keeps the Phoenix chat surface available', () => {
        expectMethods(CHAT_SOURCE, [
            'init',
            'updateConfig',
            'createThread',
            'loadThread',
            'loadThreads',
            'deleteThread',
            'getOrCreateThread',
            'addMessage',
            'addUserMessage',
            'addAssistantMessage',
            'updateMessage',
            'appendMessage',
            'startStreamingMessage',
            'clearThread',
            'exportThread',
            'startRun',
            'pollRun',
            'resumeRun',
            'cancelRun',
            'listRunEvents',
            'markRunStreaming',
            'completeRun',
            'streamChat',
            'newSession',
        ]);
    });
});
