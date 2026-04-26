import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Network,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-angular';
import { LucideAngularModule } from 'lucide-angular';

import { db } from '../../../lib/dexie/db';
import { smartGraphRegistry, type RegisteredEntity } from '../../../lib/registry';
import { parseContentToPlainText } from '../../../lib/analytics';
import {
  ScopedTimelineEventRecord,
  ScopedTimelineEventStoreService,
} from '../../../lib/services/scoped-timeline-event-store.service';
import { NliWorkerService } from '../../../lib/services/nli-worker.service';
import { SemanticSearchService } from '../../../lib/services/semantic-search.service';
import type { EntitySuggestionProviderId } from '../../../lib/entity-suggestions/entity-suggestion.types';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { FooterStatsService } from '../../../services/footer-stats.service';
import { NerService } from '../../../services/ner.service';
import { FactSheetService } from '../fact-sheet.service';
import type { ParsedEntity } from '../fact-sheet-container/fact-sheet-container.component';
import type { EntityKind } from '../../../lib/Scanner/types';

interface StewardRelation {
  id: string;
  type: string;
  targetEntityId: string;
  targetLabel: string;
  note: string;
  createdAt: number;
}

const RELATION_KEY = 'stewardRelations';
const DIRECTIVE_KEY = 'stewardMachineDirectives';
const NLI_MODEL_ID = 'onnx-community/ModernBERT-base-nli-ONNX';
type DirectiveKey = 'cooccurrence' | 'ner' | 'nli' | 'semantic';
type ModelLaneTone = 'idle' | 'ready' | 'busy' | 'error';

interface StewardModelLane {
  key: DirectiveKey;
  label: string;
  value: string;
  detail: string;
  tone: ModelLaneTone;
  disabled: boolean;
}

@Component({
  selector: 'app-entity-steward',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    @if (entity(); as ent) {
    <div class="steward-shell">
      <header class="steward-hero">
        <div><span class="kicker">Human in the loop</span><h3>{{ ent.label }}</h3><p>Curate graph truth, timeline placement, and model-facing evidence.</p></div>
        <lucide-icon [img]="SparklesIcon" class="hero-icon"></lucide-icon>
      </header>

      <section class="machine-grid">
        @for (card of machineCards(); track card.label) {
        <div class="machine-card">
          <lucide-icon [img]="card.icon" class="machine-icon"></lucide-icon>
          <span>{{ card.label }}</span><strong>{{ card.value }}</strong><small>{{ card.detail }}</small>
        </div>
        }
      </section>

      <section class="steward-panel">
        <div class="panel-head"><lucide-icon [img]="PencilIcon" class="panel-icon"></lucide-icon><div><h4>Entity Identity</h4><p>Registry-facing label and kind.</p></div></div>
        <div class="field-grid">
          <label><span>Label</span><input type="text" [ngModel]="editLabel()" (ngModelChange)="editLabel.set($event)" /></label>
          <label><span>Kind</span><input type="text" [ngModel]="editKind()" (ngModelChange)="editKind.set($event)" /></label>
        </div>
        <button type="button" class="steward-action" (click)="saveEntityIdentity()">Save Identity</button>
      </section>

      <section class="steward-panel">
        <div class="panel-head"><lucide-icon [img]="NetworkIcon" class="panel-icon"></lucide-icon><div><h4>Curated Relations</h4><p>Edges the machine can ingest as explicit human truth.</p></div></div>
        <div class="relation-grid">
          <select [ngModel]="relationType()" (ngModelChange)="relationType.set($event)">
            <option value="relates_to">relates to</option><option value="member_of">member of</option><option value="leads">leads</option>
            <option value="opposes">opposes</option><option value="located_in">located in</option><option value="caused_by">caused by</option>
          </select>
          <select [ngModel]="relationTargetId()" (ngModelChange)="relationTargetId.set($event)">
            @for (target of allEntities(); track target.id) { @if (target.id !== ent.id) { <option [value]="target.id">{{ target.kind }} | {{ target.label }}</option> } }
          </select>
        </div>
        <input class="wide-input" type="text" placeholder="Why this relation matters..." [ngModel]="relationNote()" (ngModelChange)="relationNote.set($event)" />
        <button type="button" class="steward-action" (click)="addRelation()">Add Relation</button>
        <div class="compact-list">
          @for (relation of relations(); track relation.id) {
          <button type="button" class="list-row" (click)="removeRelation(relation.id)"><span>{{ relation.type }}</span><strong>{{ relation.targetLabel }}</strong><small>{{ relation.note || 'No note' }}</small></button>
          } @empty { <div class="empty-row">No curated relations yet.</div> }
        </div>
      </section>

      <section class="steward-panel">
        <div class="panel-head"><lucide-icon [img]="PlusIcon" class="panel-icon"></lucide-icon><div><h4>Timeline Event</h4><p>Create or attach events so OverGraph sees time and causality.</p></div></div>
        <input type="text" placeholder="Event title..." [ngModel]="eventTitle()" (ngModelChange)="eventTitle.set($event)" />
        <input type="text" placeholder="When / order / chapter..." [ngModel]="eventTime()" (ngModelChange)="eventTime.set($event)" />
        <textarea rows="3" placeholder="What changed?" [ngModel]="eventDescription()" (ngModelChange)="eventDescription.set($event)"></textarea>
        <button type="button" class="steward-action" (click)="createEvent()">Create Linked Event</button>
        <div class="compact-list">
          @for (event of entityEvents(); track event.id) {
          <div class="list-row locked"><span>{{ event.displayTime || event.source }}</span><strong>{{ event.title }}</strong><small>{{ event.description || 'No description' }}</small></div>
          } @empty { <div class="empty-row">No timeline events linked to this entity.</div> }
        </div>
      </section>

      @if (linkableEvents().length) {
      <section class="steward-panel">
        <div class="panel-head"><lucide-icon [img]="CheckIcon" class="panel-icon"></lucide-icon><div><h4>Attach Existing Events</h4><p>Bind timeline records to this entity.</p></div></div>
        <div class="compact-list">
          @for (event of linkableEvents(); track event.id) {
          <button type="button" class="list-row" (click)="linkEvent(event)"><span>{{ event.displayTime || event.source }}</span><strong>{{ event.title }}</strong><small>{{ event.description || 'Attach this event' }}</small></button>
          }
        </div>
      </section>
      }

      <section class="model-surface">
        <div class="panel-head"><lucide-icon [img]="BrainIcon" class="panel-icon"></lucide-icon><div><h4>Model Review Lanes</h4><p>Human-approved work orders for extraction, evidence, and adjudication.</p></div></div>
        <div class="model-lane-grid">
          @for (lane of modelLanes(); track lane.key) {
          <button
            type="button"
            class="model-lane"
            [class.status-idle]="lane.tone === 'idle'"
            [class.status-ready]="lane.tone === 'ready'"
            [class.status-busy]="lane.tone === 'busy'"
            [class.status-error]="lane.tone === 'error'"
            [disabled]="lane.disabled"
            (click)="runModelLane(lane.key)"
          >
            <span>{{ lane.label }}</span><strong>{{ lane.value }}</strong><small>{{ lane.detail }}</small>
          </button>
          } 
        </div>
      </section>
      @if (notice()) { <div class="notice">{{ notice() }}</div> }
    </div>
    }
  `,
  styles: [`
    :host{display:block;height:100%;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(94,234,212,.24) transparent}
    .steward-shell{display:flex;min-height:100%;flex-direction:column;gap:8px;padding:0 0 64px}
    .steward-hero,.steward-panel,.model-surface,.notice{border:1px solid rgba(94,234,212,.22);border-radius:8px;background:linear-gradient(145deg,rgba(8,13,19,.96),rgba(6,8,12,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
    .steward-hero{position:relative;display:flex;min-height:104px;align-items:center;justify-content:space-between;gap:10px;overflow:hidden;padding:14px 14px 14px 16px}
    .steward-hero:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 78% 50%,rgba(45,212,191,.34),transparent 22%),linear-gradient(90deg,rgba(20,184,166,.1),transparent 62%);opacity:.9}
    .steward-hero:after{content:"";position:absolute;right:22px;top:18px;width:82px;height:82px;border:1px solid rgba(94,234,212,.35);border-radius:999px;box-shadow:0 0 34px rgba(45,212,191,.26)}
    .steward-hero>div,.hero-icon{position:relative;z-index:1}.hero-icon{width:34px;height:34px;margin-right:24px;color:#99f6e4;filter:drop-shadow(0 0 14px rgba(45,212,191,.6))}
    .kicker,.machine-card span,.panel-head p,.status-chip span{color:#5eead4;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
    h3,h4,p{margin:0}h3{margin-top:7px;color:#f8fafc;font-size:23px;font-weight:900;line-height:1}.steward-hero p,.model-surface p{margin-top:7px;color:#cbd5e1;font-size:12px;line-height:1.45}
    .machine-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid rgba(148,163,184,.26);border-radius:8px;overflow:hidden}
    .machine-card{display:grid;min-width:0;grid-template-columns:auto minmax(0,1fr);gap:4px 9px;border:0;border-right:1px solid rgba(148,163,184,.22);border-bottom:1px solid rgba(148,163,184,.22);background:linear-gradient(145deg,rgba(15,23,32,.82),rgba(5,7,11,.94));padding:13px}
    .machine-card:nth-child(2n){border-right:0}.machine-card:nth-last-child(-n+2){border-bottom:0}.machine-icon,.panel-icon{color:#5eead4}.machine-icon{grid-row:1/4;width:18px;height:18px;margin-top:1px}
    .machine-card strong{display:block;color:#f8fafc;font-size:18px;font-weight:900;line-height:1}.machine-card small{display:block;overflow:hidden;color:#94a3b8;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .steward-panel,.model-surface{display:flex;flex-direction:column;gap:10px;padding:12px 12px 13px}.panel-head{display:flex;min-width:0;align-items:flex-start;gap:9px}.panel-icon{width:18px;height:18px;flex-shrink:0}.panel-head p{margin-top:2px;color:#94a3b8;letter-spacing:.08em}h4{color:#5eead4;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
    .field-grid,.relation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}label{min-width:0}label span{display:block;margin-bottom:5px;color:#94a3b8;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
    input,select,textarea{width:100%;border:1px solid rgba(148,163,184,.28);border-radius:7px;background:rgba(1,4,10,.58);padding:8px 10px;color:#e5e7eb;font-size:12px;outline:none}textarea{resize:vertical}
    input:focus,select:focus,textarea:focus{border-color:rgba(45,212,191,.64);box-shadow:0 0 0 1px rgba(45,212,191,.18),0 0 20px rgba(45,212,191,.08)}.wide-input{grid-column:1/-1}
    .steward-action{display:inline-flex;min-height:33px;align-items:center;justify-content:center;border:1px solid rgba(45,212,191,.42);border-radius:7px;background:linear-gradient(90deg,rgba(20,184,166,.28),rgba(13,148,136,.2));color:#ccfbf1;font-size:12px;font-weight:900}
    .compact-list{display:flex;flex-direction:column;gap:6px}.list-row,.empty-row{border:1px solid rgba(148,163,184,.18);border-radius:7px;background:rgba(0,0,0,.24);padding:8px 9px;text-align:left}
    .list-row{display:grid;grid-template-columns:minmax(54px,auto) minmax(0,1fr);gap:5px 9px}.list-row span{color:#5eead4;font-size:10px;font-weight:900;text-transform:uppercase}.list-row strong{min-width:0;overflow:hidden;color:#f4f4f5;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .list-row small{grid-column:1/-1;overflow:hidden;color:#94a3b8;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.locked{cursor:default}.empty-row{color:#94a3b8;font-size:12px}
    .model-lane-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.model-lane{position:relative;min-width:0;border:1px solid rgba(148,163,184,.24);border-radius:7px;background:rgba(0,0,0,.24);padding:9px 10px;text-align:left}.model-lane:after{content:"";position:absolute;right:9px;top:9px;width:7px;height:7px;border-radius:999px;background:#ef4444;box-shadow:0 0 10px rgba(239,68,68,.65)}.model-lane.status-ready:after{background:#2dd4bf;box-shadow:0 0 10px rgba(45,212,191,.72)}.model-lane.status-busy:after{background:#facc15;box-shadow:0 0 10px rgba(250,204,21,.65)}.model-lane.status-error:after{background:#fb7185;box-shadow:0 0 10px rgba(251,113,133,.74)}.model-lane span{display:block;color:#5eead4;font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.model-lane strong{display:block;margin-top:5px;color:#f4f4f5;font-size:13px}.model-lane small{display:block;overflow:hidden;color:#94a3b8;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.model-lane:disabled{cursor:wait;opacity:.72}.notice{padding:9px 10px;color:#99f6e4;font-size:12px}
  `],
})
export class EntityStewardComponent {
  private readonly factSheets = inject(FactSheetService);
  private readonly timeline = inject(ScopedTimelineEventStoreService);
  private readonly ner = inject(NerService);
  private readonly noteStore = inject(NoteEditorStore);
  private readonly footerStats = inject(FooterStatsService);
  private readonly nli = inject(NliWorkerService);
  private readonly semantic = inject(SemanticSearchService);

  readonly entity = input<ParsedEntity | null>(null);
  readonly contextId = input<string>('global');

  readonly allEntities = signal<RegisteredEntity[]>([]);
  readonly relations = signal<StewardRelation[]>([]);
  readonly notice = signal<string | null>(null);

  readonly editLabel = signal('');
  readonly editKind = signal('');
  readonly relationType = signal('relates_to');
  readonly relationTargetId = signal('');
  readonly relationNote = signal('');
  readonly eventTitle = signal('');
  readonly eventDescription = signal('');
  readonly eventTime = signal('');
  readonly activeModelLane = signal<DirectiveKey | null>(null);
  readonly directiveState = signal<Record<DirectiveKey, boolean>>({
    cooccurrence: true,
    ner: true,
    nli: false,
    semantic: false,
  });

  readonly events = this.timeline.events;
  readonly entityEvents = computed(() => {
    const id = this.entity()?.id;
    return id ? this.events().filter(event => event.entityIds.includes(id)) : [];
  });
  readonly linkableEvents = computed(() => {
    const id = this.entity()?.id;
    return id ? this.events().filter(event => !event.entityIds.includes(id)).slice(0, 6) : [];
  });

  readonly machineCards = computed(() => [
    {
      label: 'Registry',
      value: this.entity() ? 'ready' : 'idle',
      detail: 'label, kind, aliases',
      icon: ShieldCheck,
    },
    {
      label: 'Timeline',
      value: `${this.entityEvents().length}`,
      detail: 'linked events',
      icon: CalendarClock,
    },
    {
      label: 'Relations',
      value: `${this.relations().length}`,
      detail: 'human curated',
      icon: GitBranch,
    },
    {
      label: 'Models',
      value: 'review',
      detail: 'NER, NLI, co-occurrence',
      icon: Brain,
    },
  ]);
  readonly modelLanes = computed<StewardModelLane[]>(() => {
    const active = this.activeModelLane();
    const statuses = this.ner.providerStatuses();
    const fst = statuses.fst;
    const gliner = statuses.gliner_local;
    const semanticBusy = this.semantic.isIndexing() || active === 'semantic';
    const nliBusy = this.nli.isProcessing() || active === 'nli';
    return [
      this.providerLane('cooccurrence', 'Co-occur', fst, 'Phoenix scanner', active),
      this.providerLane('ner', 'NER', gliner, 'GLiNER local', active),
      {
        key: 'nli',
        label: 'NLI',
        value: nliBusy ? 'running' : this.nli.isInitialized() ? 'ready' : 'idle',
        detail: this.nli.modelId() || 'GLiNER class instruct',
        tone: nliBusy ? 'busy' : this.nli.isInitialized() ? 'ready' : 'idle',
        disabled: active !== null,
      },
      {
        key: 'semantic',
        label: 'Semantic',
        value: semanticBusy ? 'indexing' : this.semantic.isModelLoaded() ? 'ready' : 'idle',
        detail: `${this.semantic.modelDimension() || 0}d embeddings`,
        tone: semanticBusy ? 'busy' : this.semantic.isModelLoaded() ? 'ready' : 'idle',
        disabled: active !== null,
      },
    ];
  });

  readonly PencilIcon = Pencil;
  readonly PlusIcon = Plus;
  readonly NetworkIcon = Network;
  readonly SparklesIcon = Sparkles;
  readonly CheckIcon = CheckCircle2;
  readonly BrainIcon = Brain;

  constructor() {
    effect(() => {
      const entity = this.entity();
      this.editLabel.set(entity?.label ?? '');
      this.editKind.set(entity?.kind ?? '');
      void this.refreshCuration();
    });
  }

  async saveEntityIdentity(): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    const label = this.editLabel().trim();
    const kind = this.editKind().trim().toUpperCase();
    if (!label || !kind) return;
    await smartGraphRegistry.updateEntityDurable(entity.id, { label, kind: kind as any });
    this.notice.set('Entity identity saved to the registry.');
    await this.refreshEntities();
  }

  async addRelation(): Promise<void> {
    const entity = this.entity();
    const targetId = this.relationTargetId();
    if (!entity || !targetId) return;
    const target = this.allEntities().find(item => item.id === targetId);
    if (!target) return;

    const next = [
      ...this.relations(),
      {
        id: crypto.randomUUID(),
        type: this.relationType(),
        targetEntityId: target.id,
        targetLabel: target.label,
        note: this.relationNote().trim(),
        createdAt: Date.now(),
      },
    ];
    await this.saveRelations(next);
    this.relationNote.set('');
    this.notice.set('Curated relation saved for graph ingestion.');
  }

  async createEvent(): Promise<void> {
    const entity = this.entity();
    const title = this.eventTitle().trim();
    if (!entity || !title) return;
    const created = await this.timeline.createEvent({
      title,
      description: this.eventDescription().trim() || undefined,
      displayTime: this.eventTime().trim() || undefined,
      entityIds: [entity.id],
      source: 'timeline',
      status: 'draft',
    });
    this.notice.set(created ? 'Timeline event created with this entity attached.' : 'Open a narrative scope to create timeline events.');
    if (created) {
      this.eventTitle.set('');
      this.eventDescription.set('');
      this.eventTime.set('');
    }
  }

  async linkEvent(event: ScopedTimelineEventRecord): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    await this.timeline.updateEvent(event.id, {
      entityIds: Array.from(new Set([...event.entityIds, entity.id])),
    });
    this.notice.set('Entity linked to timeline event.');
  }

  async removeRelation(id: string): Promise<void> {
    await this.saveRelations(this.relations().filter(relation => relation.id !== id));
  }

  async runModelLane(key: DirectiveKey): Promise<void> {
    if (this.activeModelLane()) return;
    this.activeModelLane.set(key);
    try {
      if (key === 'cooccurrence') {
        await this.runProviderScan('fst', 'Co-occurrence scan completed.');
      } else if (key === 'ner') {
        await this.runProviderScan('gliner_local', 'GLiNER NER scan completed.');
      } else if (key === 'semantic') {
        await this.runSemanticLane();
      } else {
        await this.nli.initialize(NLI_MODEL_ID);
        this.notice.set('NLI classifier is warm and ready for adjudication jobs.');
      }
      await this.saveDirectivePulse(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Model lane failed.';
      this.notice.set(message);
    } finally {
      this.activeModelLane.set(null);
    }
  }

  private async refreshCuration(): Promise<void> {
    await Promise.all([this.refreshEntities(), this.refreshRelations(), this.refreshDirectives()]);
  }

  private async refreshEntities(): Promise<void> {
    const rows = await db.entities.toArray();
    this.allEntities.set(rows.map(row => ({
      id: row.id,
      label: row.label,
      kind: row.kind as EntityKind,
      aliases: [],
      firstNote: row.firstNote ?? '',
      mentionsByNote: new Map<string, number>(),
      totalMentions: 0,
      lastSeenDate: new Date(row.createdAt),
      createdAt: new Date(row.createdAt),
      createdBy: row.createdBy ?? 'user',
      registeredAt: row.createdAt,
      noteId: row.firstNote ?? undefined,
    })));
    const current = this.entity();
    const firstTarget = rows.find(row => row.id !== current?.id)?.id ?? '';
    if (!this.relationTargetId()) this.relationTargetId.set(firstTarget);
  }

  private async refreshRelations(): Promise<void> {
    const entity = this.entity();
    if (!entity) {
      this.relations.set([]);
      return;
    }
    const attrs = await this.factSheets.loadAttributes(entity.id, this.contextId());
    const relations = Array.isArray(attrs[RELATION_KEY]) ? attrs[RELATION_KEY] : [];
    this.relations.set(relations.filter(this.isRelation));
  }

  private async saveRelations(relations: StewardRelation[]): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    this.relations.set(relations);
    await this.factSheets.setAttribute(entity.id, RELATION_KEY, relations, this.contextId());
  }

  private async refreshDirectives(): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    const attrs = await this.factSheets.loadAttributes(entity.id, this.contextId());
    const saved = attrs[DIRECTIVE_KEY] as Partial<Record<DirectiveKey, boolean>> | undefined;
    if (!saved || typeof saved !== 'object') return;
    this.directiveState.update(current => ({
      ...current,
      cooccurrence: typeof saved.cooccurrence === 'boolean' ? saved.cooccurrence : current.cooccurrence,
      ner: typeof saved.ner === 'boolean' ? saved.ner : current.ner,
      nli: typeof saved.nli === 'boolean' ? saved.nli : current.nli,
      semantic: typeof saved.semantic === 'boolean' ? saved.semantic : current.semantic,
    }));
  }

  private async runProviderScan(providerId: EntitySuggestionProviderId, message: string): Promise<void> {
    const request = this.buildScanRequest();
    if (!request) {
      this.notice.set('Open a note with rendered text before running this lane.');
      return;
    }
    await this.ner.runManualScan(providerId, request);
    this.notice.set(message);
  }

  private async runSemanticLane(): Promise<void> {
    const request = this.buildScanRequest();
    const currentNote = this.noteStore.currentNote();
    if (!request || !currentNote) {
      this.notice.set('Open a note with rendered text before warming semantic support.');
      return;
    }
    await this.semantic.indexNotes([{
      id: request.noteId,
      narrativeId: currentNote.narrativeId || 'global',
      title: request.noteTitle || 'Untitled Note',
      content: request.plainText,
    }]);
    this.notice.set('Semantic embedding lane queued for the active note.');
  }

  private buildScanRequest() {
    const currentNote = this.noteStore.currentNote();
    if (!currentNote) return null;
    const plainText =
      this.footerStats.plainText() ||
      parseContentToPlainText(currentNote.content || currentNote.markdownContent || '');
    if (!plainText.trim()) return null;
    return {
      noteId: currentNote.id,
      noteTitle: currentNote.title || 'Untitled Note',
      plainText,
    };
  }

  private async saveDirectivePulse(key: DirectiveKey): Promise<void> {
    const entity = this.entity();
    if (!entity) return;
    const next = { ...this.directiveState(), [key]: true };
    this.directiveState.set(next);
    await this.factSheets.setAttribute(entity.id, DIRECTIVE_KEY, next, this.contextId());
  }

  private providerLane(
    key: DirectiveKey,
    label: string,
    status: { ready: boolean; loading: boolean; device: string | null; error?: string },
    fallbackDetail: string,
    active: DirectiveKey | null,
  ): StewardModelLane {
    const tone = this.providerTone(status, active === key);
    return {
      key,
      label,
      value: active === key ? 'running' : status.loading ? 'loading' : status.ready ? 'ready' : status.error ? 'error' : 'idle',
      detail: status.error || status.device || fallbackDetail,
      tone,
      disabled: active !== null,
    };
  }

  private providerTone(
    status: { ready: boolean; loading: boolean; error?: string },
    active: boolean,
  ): ModelLaneTone {
    if (active || status.loading) return 'busy';
    if (status.error) return 'error';
    return status.ready ? 'ready' : 'idle';
  }

  private isRelation(value: unknown): value is StewardRelation {
    const relation = value as Partial<StewardRelation>;
    return !!relation && typeof relation.id === 'string' && typeof relation.targetEntityId === 'string';
  }
}
