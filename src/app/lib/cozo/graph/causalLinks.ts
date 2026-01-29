import { cozoDb } from '../db';
import type { GraphScope } from '../types';
import { generateId } from '../utils';

export type CausalType = 'TRIGGERS' | 'PREVENTS' | 'ENABLES';

export interface CausalLinkOptions {
    scope: GraphScope;
    scopeId: string;
    useLLM: boolean;
    llmConfig?: {
        apiKey?: string;
        model?: string;
        endpoint?: string;
    };
}

export interface CausalLinkResult {
    linkCount: number;
}

interface CausalLink {
    triggerId: string;
    causedId: string;
    causalType: CausalType;
    confidence: number;
}

interface EventWithContext {
    eventId: string;
    eventName: string;
    episodeId: string;
    contentText: string;
}

const CAUSAL_PATTERNS: Array<{ pattern: RegExp; type: CausalType }> = [
    { pattern: /(.+?)\s+(?:caused|led to|triggered|resulted in|sparked|initiated|set off)\s+(.+)/gi, type: 'TRIGGERS' },
    { pattern: /(?:because of|due to|as a result of|following)\s+(.+?)[,.]?\s+(.+)/gi, type: 'TRIGGERS' },
    { pattern: /(.+?)\s+(?:prevented|stopped|blocked|halted|averted|thwarted)\s+(.+)/gi, type: 'PREVENTS' },
    { pattern: /(.+?)\s+(?:enabled|allowed|made possible|facilitated|permitted)\s+(.+)/gi, type: 'ENABLES' },
    { pattern: /(.+?)\s+(?:paved the way for|opened the door to)\s+(.+)/gi, type: 'ENABLES' },
];

export async function extractCausalLinks(
    options: CausalLinkOptions
): Promise<CausalLinkResult> {
    const groupId = options.scope === 'vault'
        ? 'vault:global'
        : `${options.scope}:${options.scopeId}`;

    if (options.useLLM && options.llmConfig) {
        return extractCausalLinksWithLLM(groupId, options);
    } else {
        return extractCausalLinksWithPatterns(groupId);
    }
}

async function extractCausalLinksWithPatterns(
    groupId: string
): Promise<CausalLinkResult> {
    try {
        const eventsResult = cozoDb.runQuery(`
      ?[event_id, event_name, episode_id, content_text] :=
        *entity{id: event_id, name: event_name, entity_kind, group_id},
        entity_kind == "EVENT",
        group_id == $group_id,
        *mentions{entity_id: event_id, episode_id},
        *episode{id: episode_id, content_text}
    `, { group_id: groupId });

        if (!eventsResult.rows || eventsResult.rows.length === 0) {
            return { linkCount: 0 };
        }

        const episodeEvents = new Map<string, EventWithContext[]>();

        for (const row of eventsResult.rows) {
            const event: EventWithContext = {
                eventId: row[0] as string,
                eventName: row[1] as string,
                episodeId: row[2] as string,
                contentText: row[3] as string,
            };

            if (!episodeEvents.has(event.episodeId)) {
                episodeEvents.set(event.episodeId, []);
            }
            episodeEvents.get(event.episodeId)!.push(event);
        }

        const causalLinks: CausalLink[] = [];

        for (const [episodeId, events] of episodeEvents) {
            if (events.length < 2) continue;

            const content = events[0].contentText;
            if (!content) continue;

            for (const { pattern, type } of CAUSAL_PATTERNS) {
                pattern.lastIndex = 0;
                let match: RegExpExecArray | null;

                while ((match = pattern.exec(content)) !== null) {
                    const [, cause, effect] = match;

                    const causeEvent = findMatchingEvent(events, cause);
                    const effectEvent = findMatchingEvent(events, effect);

                    if (causeEvent && effectEvent && causeEvent.eventId !== effectEvent.eventId) {
                        const existingLink = causalLinks.find(
                            l => l.triggerId === causeEvent.eventId && l.causedId === effectEvent.eventId
                        );

                        if (!existingLink) {
                            causalLinks.push({
                                triggerId: causeEvent.eventId,
                                causedId: effectEvent.eventId,
                                causalType: type,
                                confidence: 0.7,
                            });
                        }
                    }
                }
            }
        }

        await insertCausalLinks(causalLinks);

        return { linkCount: causalLinks.length };
    } catch (err) {
        console.error('Failed to extract causal links with patterns:', err);
        return { linkCount: 0 };
    }
}

function findMatchingEvent(
    events: EventWithContext[],
    text: string
): EventWithContext | undefined {
    const normalizedText = text.toLowerCase().trim();

    return events.find(e => {
        const eventName = e.eventName.toLowerCase();
        return normalizedText.includes(eventName) || eventName.includes(normalizedText);
    });
}

async function extractCausalLinksWithLLM(
    groupId: string,
    options: CausalLinkOptions
): Promise<CausalLinkResult> {
    try {
        const eventQuery = `
      ?[event_id, event_name] :=
        *entity{id: event_id, name: event_name, entity_kind, group_id},
        entity_kind == "EVENT",
        group_id == $group_id
    `;

        const events = cozoDb.runQuery(eventQuery, { group_id: groupId });

        if (!events.rows || events.rows.length < 2) {
            return { linkCount: 0 };
        }

        const eventNames = events.rows.map((row: unknown[]) => row[1] as string);
        // Unused map removed or kept if needed later
        // const eventMap = new Map<string, string>(...);

        const prompt = buildCausalPrompt(eventNames);

        console.log('LLM causal extraction would use prompt:', prompt.substring(0, 200) + '...');
        console.log('LLM extraction not implemented - falling back to pattern-based');

        return extractCausalLinksWithPatterns(groupId);
    } catch (err) {
        console.error('LLM causal extraction failed:', err);
        return extractCausalLinksWithPatterns(groupId);
    }
}

function buildCausalPrompt(eventNames: string[]): string {
    return `Analyze causal relationships between these story events:

Events:
${eventNames.map((name, idx) => `${idx + 1}. ${name}`).join('\n')}

Identify which events:
- TRIGGERS other events (direct causation)
- ENABLES other events (makes possible)
- PREVENTS other events (blocks from happening)

Return JSON:
{
  "causal_links": [
    {
      "trigger_event": "Event Name",
      "caused_event": "Other Event Name",
      "causal_type": "TRIGGERS",
      "confidence": 0.9
    }
  ]
}

Only include relationships you're confident about. Return empty array if uncertain.`;
}

async function insertCausalLinks(links: CausalLink[]): Promise<void> {
    if (links.length === 0) return;

    for (const link of links) {
        try {
            const existingResult = cozoDb.runQuery(`
        ?[id] :=
          *causal_link{id, trigger_event_id, caused_event_id},
          trigger_event_id == $trigger_id,
          caused_event_id == $caused_id
      `, {
                trigger_id: link.triggerId,
                caused_id: link.causedId,
            });

            if (existingResult.rows && existingResult.rows.length > 0) {
                continue;
            }

            cozoDb.runQuery(`
        ?[id, trigger_event_id, caused_event_id, causal_type, confidence, created_at] <- [[
          $id, $trigger_id, $caused_id, $causal_type, $confidence, $created_at
        ]]

        :put causal_link {
          id, trigger_event_id, caused_event_id, causal_type, confidence, created_at
        }
      `, {
                id: generateId(),
                trigger_id: link.triggerId,
                caused_id: link.causedId,
                causal_type: link.causalType,
                confidence: link.confidence,
                created_at: Date.now(),
            });
        } catch (err) {
            console.error('Failed to insert causal link:', err);
        }
    }
}

export async function getCausalLinks(
    groupId: string
): Promise<Array<{
    id: string;
    triggerId: string;
    triggerName: string;
    causedId: string;
    causedName: string;
    causalType: CausalType;
    confidence: number;
}>> {
    try {
        const result = cozoDb.runQuery(`
      ?[id, trigger_id, trigger_name, caused_id, caused_name, causal_type, confidence] :=
        *causal_link{id, trigger_event_id: trigger_id, caused_event_id: caused_id, causal_type, confidence},
        *entity{id: trigger_id, name: trigger_name, group_id},
        *entity{id: caused_id, name: caused_name, group_id},
        group_id == $group_id
    `, { group_id: groupId });

        if (!result.rows) return [];

        return result.rows.map((row: unknown[]) => ({
            id: row[0] as string,
            triggerId: row[1] as string,
            triggerName: row[2] as string,
            causedId: row[3] as string,
            causedName: row[4] as string,
            causalType: row[5] as CausalType,
            confidence: row[6] as number,
        }));
    } catch (err) {
        console.error('Failed to get causal links:', err);
        return [];
    }
}

export async function getCausalChain(
    startEventId: string,
    maxDepth: number = 5
): Promise<Array<{
    eventId: string;
    eventName: string;
    depth: number;
}>> {
    try {
        const result = cozoDb.runQuery(`
      chain[event_id, next_event_id, depth] :=
        *causal_link{trigger_event_id: event_id, caused_event_id: next_event_id},
        depth = 1

      chain[event_id, next_event_id, depth] :=
        *causal_link{trigger_event_id: event_id, caused_event_id: mid_event},
        chain[mid_event, next_event_id, d],
        depth = d + 1,
        depth <= $max_depth

      ?[event_id, event_name, depth] :=
        chain[$start_event_id, event_id, depth],
        *entity{id: event_id, name: event_name}

      :order depth
    `, {
            start_event_id: startEventId,
            max_depth: maxDepth,
        });

        if (!result.rows) return [];

        return result.rows.map((row: unknown[]) => ({
            eventId: row[0] as string,
            eventName: row[1] as string,
            depth: row[2] as number,
        }));
    } catch (err) {
        console.error('Failed to get causal chain:', err);
        return [];
    }
}

export async function deleteCausalLink(
    triggerId: string,
    causedId: string
): Promise<boolean> {
    try {
        cozoDb.runQuery(`
      ?[id] :=
        *causal_link{id, trigger_event_id, caused_event_id},
        trigger_event_id == $trigger_id,
        caused_event_id == $caused_id

      :rm causal_link { id }
    `, {
            trigger_id: triggerId,
            caused_id: causedId,
        });

        return true;
    } catch (err) {
        console.error('Failed to delete causal link:', err);
        return false;
    }
}
