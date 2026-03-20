import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import type { CalendarEventTargetNote } from '../../../services/calendar.service';

@Component({
    selector: 'app-event-target-picker',
    standalone: true,
    imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
    template: `
        <p-dialog
            [header]="'Select Target Note'"
            [(visible)]="visible"
            [modal]="true"
            [draggable]="false"
            [style]="{ width: '28rem' }"
            (onHide)="handleHide()"
        >
            <div class="space-y-4">
                <p class="text-sm text-muted-foreground">
                    Choose which open note should receive {{ eventCount === 1 ? 'this event snapshot' : 'these event snapshots' }}.
                </p>

                <div *ngIf="targets.length > 0" class="space-y-2 max-h-72 overflow-y-auto">
                    <label
                        *ngFor="let target of targets"
                        class="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <input
                            type="radio"
                            name="calendar-event-target-note"
                            [value]="target.noteId"
                            [(ngModel)]="selectedNoteId"
                            class="mt-1"
                        />
                        <div class="min-w-0">
                            <div class="text-sm font-medium truncate">{{ target.title }}</div>
                            <div class="text-xs text-muted-foreground">
                                {{ target.active ? 'Active tab' : 'Open tab' }}
                            </div>
                        </div>
                    </label>
                </div>

                <div *ngIf="targets.length === 0" class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Open a note in the current scope first.
                </div>
            </div>

            <ng-template pTemplate="footer">
                <div class="flex justify-end gap-2">
                    <p-button
                        label="Cancel"
                        [text]="true"
                        (onClick)="cancel()"
                    ></p-button>
                    <p-button
                        label="Continue"
                        [disabled]="!selectedNoteId || targets.length === 0"
                        (onClick)="submit()"
                    ></p-button>
                </div>
            </ng-template>
        </p-dialog>
    `,
})
export class EventTargetPickerComponent implements OnChanges {
    @Input() visible = false;
    @Output() visibleChange = new EventEmitter<boolean>();

    @Input() targets: CalendarEventTargetNote[] = [];
    @Input() eventCount = 1;
    @Output() confirmTarget = new EventEmitter<string>();

    selectedNoteId = '';

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['visible'] || changes['targets']) {
            this.ensureSelection();
        }
    }

    submit(): void {
        if (!this.selectedNoteId) {
            return;
        }

        this.confirmTarget.emit(this.selectedNoteId);
        this.close();
    }

    cancel(): void {
        this.close();
    }

    handleHide(): void {
        this.visibleChange.emit(false);
    }

    private close(): void {
        this.visible = false;
        this.visibleChange.emit(false);
    }

    private ensureSelection(): void {
        if (this.targets.length === 0) {
            this.selectedNoteId = '';
            return;
        }

        if (!this.targets.some(target => target.noteId === this.selectedNoteId)) {
            this.selectedNoteId = this.targets[0].noteId;
        }
    }
}
