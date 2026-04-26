import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { PlaygroundLogService } from '../../services/playground-log.service';
import { NumerologyStyle, processNumerologyDocument } from '../../lib/numerology/numerology';

const STYLE_OPTIONS: { label: string; value: NumerologyStyle }[] = [
  { label: 'Annotated 1-26', value: 'annotatedOrdinal' },
  { label: 'Annotated 1-9', value: 'annotatedReduced' },
  { label: 'Numbers Only 1-9', value: 'numberOnlyReduced' },
];

@Component({
  selector: 'app-numerology-module',
  standalone: true,
  imports: [CommonModule, FormsModule, Button, SelectModule, TextareaModule],
  template: `
    <div class="module-numerology">
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-cyan-400">{{ sourceBytesLabel() }}</span>
          <span class="stat-label">Source</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-emerald-400">{{ result()?.words ?? 0 }}</span>
          <span class="stat-label">Words</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-amber-400">{{ result()?.rootTotal ?? 0 }}</span>
          <span class="stat-label">Root</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-violet-400">{{ outputBytesLabel() }}</span>
          <span class="stat-label">Output</span>
        </div>
      </div>

      <input #fileInput type="file" accept=".txt,.md,text/plain,text/markdown" hidden
             (change)="onFileSelected($event)">

      <div class="setup-row">
        <div class="field-group">
          <label class="field-label">File</label>
          <button type="button" class="file-pick" (click)="fileInput.click()">
            <i class="pi pi-folder-open"></i>
            <span>{{ fileName() || 'Choose text file' }}</span>
          </button>
        </div>

        <div class="field-group narrow">
          <label class="field-label" for="numerology-style">Style</label>
          <p-select
            inputId="numerology-style"
            [options]="styleOptions"
            [(ngModel)]="style"
            optionLabel="label"
            optionValue="value"
            styleClass="style-select">
          </p-select>
        </div>
      </div>

      <div class="module-controls">
        <p-button
          label="Process"
          icon="pi pi-sparkles"
          (onClick)="process()"
          [loading]="processing()"
          [disabled]="!sourceText()"
          size="small">
        </p-button>
        <p-button
          label="Download TXT"
          icon="pi pi-download"
          (onClick)="downloadOutput()"
          [disabled]="!outputText()"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Copy"
          icon="pi pi-copy"
          (onClick)="copyOutput()"
          [disabled]="!outputText()"
          severity="secondary"
          size="small"
          [outlined]="true">
        </p-button>
        <p-button
          label="Clear"
          icon="pi pi-trash"
          (onClick)="clear()"
          severity="danger"
          size="small"
          [outlined]="true">
        </p-button>
      </div>

      <div class="workbench">
        <section class="pane">
          <div class="pane-title">Input Preview</div>
          <textarea pTextarea readonly [ngModel]="inputPreview()" rows="12"></textarea>
        </section>
        <section class="pane">
          <div class="pane-title">Processed Preview</div>
          <textarea pTextarea readonly [ngModel]="outputPreview()" rows="12"></textarea>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .module-numerology { padding: 1rem 0; }
    .module-stats { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .stat-pill {
      display: flex; flex-direction: column; align-items: center;
      background: var(--surface-card); border: 1px solid var(--surface-border);
      border-radius: 8px; padding: 0.6rem 1.2rem; min-width: 86px;
    }
    .stat-value { font-size: 1.25rem; font-weight: 700; line-height: 1.2; }
    .stat-label { font-size: 0.7rem; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .setup-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: flex-end; }
    .field-group { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 260px; }
    .field-group.narrow { flex: 0 1 260px; min-width: 220px; }
    .field-label { font-size: 0.75rem; color: var(--text-color-secondary); font-weight: 600; }
    .file-pick {
      height: 40px; border-radius: 8px; border: 1px solid var(--surface-border);
      background: var(--surface-card); color: var(--text-color); padding: 0 0.75rem;
      display: flex; align-items: center; gap: 0.5rem; cursor: pointer; text-align: left;
    }
    .file-pick:hover { border-color: var(--primary-color); }
    .module-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .workbench { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
    .pane { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
    .pane-title { font-size: 0.75rem; font-weight: 700; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
    textarea {
      width: 100%; min-height: 280px; resize: vertical; font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.78rem; line-height: 1.55; background: var(--surface-ground); color: var(--text-color);
    }
    :host ::ng-deep .style-select { width: 100%; }
    @media (max-width: 900px) { .workbench { grid-template-columns: 1fr; } }
  `],
})
export class NumerologyModuleComponent {
  @ViewChild('fileInput') private readonly fileInput?: ElementRef<HTMLInputElement>;

  private readonly logService = inject(PlaygroundLogService);

  readonly styleOptions = STYLE_OPTIONS;
  readonly fileName = signal('');
  readonly sourceText = signal('');
  readonly outputText = signal('');
  readonly processing = signal(false);
  readonly result = signal<ReturnType<typeof processNumerologyDocument> | null>(null);

  style: NumerologyStyle = 'annotatedReduced';

  readonly sourceBytesLabel = computed(() => formatBytes(this.sourceText().length));
  readonly outputBytesLabel = computed(() => formatBytes(this.outputText().length));
  readonly inputPreview = computed(() => preview(this.sourceText()));
  readonly outputPreview = computed(() => preview(this.outputText()));

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName.set(file.name);
    this.sourceText.set(await file.text());
    this.outputText.set('');
    this.result.set(null);
    this.logService.info('numerology', `Loaded ${file.name} (${formatBytes(file.size)})`);
  }

  process(): void {
    if (!this.sourceText()) return;
    this.processing.set(true);
    const started = performance.now();
    try {
      const result = processNumerologyDocument(this.sourceText(), this.style);
      this.result.set(result);
      this.outputText.set(result.output);
      const elapsed = Math.round(performance.now() - started);
      this.logService.success('numerology', `Processed ${result.words} words in ${elapsed}ms`);
    } catch (error) {
      this.logService.error('numerology', `Processing failed: ${error}`);
    } finally {
      this.processing.set(false);
    }
  }

  async copyOutput(): Promise<void> {
    if (!this.outputText()) return;
    await navigator.clipboard.writeText(this.outputText());
    this.logService.success('numerology', 'Copied processed document');
  }

  downloadOutput(): void {
    if (!this.outputText()) return;
    const name = outputName(this.fileName() || 'numerology.txt', this.style);
    const blob = new Blob([this.outputText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    this.logService.success('numerology', `Downloaded ${name}`);
  }

  clear(): void {
    this.fileName.set('');
    this.sourceText.set('');
    this.outputText.set('');
    this.result.set(null);
    if (this.fileInput?.nativeElement) this.fileInput.nativeElement.value = '';
    this.logService.info('numerology', 'Numerology lab cleared');
  }
}

function preview(text: string): string {
  return text.split('\n').slice(0, 40).join('\n');
}

function outputName(inputName: string, style: NumerologyStyle): string {
  const stem = inputName.replace(/\.[^.]+$/, '') || 'numerology';
  return `${stem}-${style}.txt`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
