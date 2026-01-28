import { Component, EventEmitter, Input, Output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CalendarEvent, EventImportance } from '../../../lib/fantasy-calendar/types';
import { CalendarService } from '../../../services/calendar.service';
import { getDaysInMonth, formatYearWithEra } from '../../../lib/fantasy-calendar/utils';

const IMPORTANCE_OPTIONS: { label: string; value: EventImportance }[] = [
    { label: 'Trivial', value: 'trivial' },
    { label: 'Minor', value: 'minor' },
    { label: 'Moderate', value: 'moderate' },
    { label: 'Major', value: 'major' },
    { label: 'Critical', value: 'critical' },
];

const STATUS_OPTIONS: { label: string; value: 'todo' | 'in-progress' | 'completed' }[] = [
    { label: 'To Do', value: 'todo' },
    { label: 'In Progress', value: 'in-progress' },
    { label: 'Completed', value: 'completed' },
];

const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1'
];

@Component({
    selector: 'app-event-edit-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        DialogModule,
        ButtonModule,
        InputTextModule,
        TextareaModule,
        SelectModule
    ],
    template: `
    <p-dialog 
        [header]="'Edit Event'" 
        [(visible)]="visible" 
        [modal]="true" 
        [style]="{ width: '500px' }"
        [closeOnEscape]="true"
        (onHide)="onClose()"
        styleClass="p-fluid"
    >
        <div class="flex flex-col gap-4 py-2" *ngIf="editedEvent">
            <!-- Title -->
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-muted-foreground">Title</label>
                <input 
                    pInputText 
                    [(ngModel)]="editedEvent.title" 
                    placeholder="Event title" 
                    class="w-full"
                />
            </div>

            <!-- Date Selection Row -->
            <div class="grid grid-cols-3 gap-2">
                <!-- Year -->
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-muted-foreground">Year</label>
                    <input 
                        pInputText 
                        type="number" 
                        [(ngModel)]="editedEvent.date.year"
                        class="w-full text-sm"
                    />
                </div>

                <!-- Month -->
                <div class="flex flex-col gap-1 col-span-1">
                    <label class="text-xs font-semibold text-muted-foreground">Month</label>
                    <select 
                        class="p-2 border rounded-md bg-background text-sm w-full"
                        [ngModel]="editedEvent.date.monthIndex"
                        (ngModelChange)="updateMonth($event)"
                    >
                        <option *ngFor="let m of calendar().months" [value]="m.index">
                            {{ m.name }}
                        </option>
                    </select>
                </div>

                <!-- Day -->
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-muted-foreground">Day</label>
                    <select
                        class="p-2 border rounded-md bg-background text-sm w-full"
                        [(ngModel)]="editedEvent.date.dayIndex"
                    >
                        <option *ngFor="let d of dayOptions()" [value]="d.value">
                            {{ d.label }}
                        </option>
                    </select>
                </div>
            </div>

            <!-- Status & Importance -->
            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-muted-foreground">Status</label>
                    <p-select 
                        [options]="statusOptions" 
                        [(ngModel)]="editedEvent.status" 
                        optionLabel="label" 
                        optionValue="value"
                        class="w-full"
                    ></p-select>
                </div>
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-muted-foreground">Importance</label>
                    <p-select 
                        [options]="importanceOptions" 
                        [(ngModel)]="editedEvent.importance" 
                        optionLabel="label" 
                        optionValue="value"
                        class="w-full"
                    ></p-select>
                </div>
            </div>

            <!-- Description -->
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-muted-foreground">Description</label>
                <textarea 
                    pTextarea 
                    [(ngModel)]="editedEvent.description" 
                    rows="3" 
                    class="w-full"
                    placeholder="Event details..."
                ></textarea>
            </div>

            <!-- Color Picker -->
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-muted-foreground">Color</label>
                <div class="flex flex-wrap gap-2">
                    <button
                        *ngFor="let c of colorPresets"
                        (click)="editedEvent.color = c"
                        class="w-6 h-6 rounded-full border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary"
                        [style.background-color]="c"
                        [class.ring-2]="editedEvent.color === c"
                        [class.ring-offset-2]="editedEvent.color === c"
                        [class.ring-primary]="editedEvent.color === c"
                    ></button>
                </div>
            </div>
        </div>

        <ng-template pTemplate="footer">
            <div class="flex justify-between w-full">
                <p-button 
                    label="Delete" 
                    icon="pi pi-trash" 
                    severity="danger" 
                    [text]="true"
                    (onClick)="handleDelete()"
                ></p-button>
                <div class="flex gap-2">
                    <p-button 
                        label="Cancel" 
                        [text]="true"
                        (onClick)="onClose()"
                    ></p-button>
                    <p-button 
                        label="Save" 
                        icon="pi pi-check" 
                        (onClick)="handleSave()"
                    ></p-button>
                </div>
            </div>
        </ng-template>
    </p-dialog>
    `,
    styles: [`
        :host { display: block; }
    `]
})
export class EventEditDialogComponent {
    private calendarService = inject(CalendarService);
    readonly calendar = this.calendarService.calendar;

    @Input() visible = false;
    @Output() visibleChange = new EventEmitter<boolean>();

    // We take an ID, then fetch the event. Or we can just take the event object.
    // Taking the event object copy is safer for "edit then cancel" logic.
    private _eventId: string | null = null;

    @Input()
    set eventId(id: string | null) {
        this._eventId = id;
        if (id) {
            const evt = this.calendarService.events().find(e => e.id === id);
            if (evt) {
                // Deep copy to avoid mutating signal directly before save
                this.editedEvent = JSON.parse(JSON.stringify(evt));
            }
        } else {
            this.editedEvent = null;
        }
    }

    editedEvent: CalendarEvent | null = null;

    readonly importanceOptions = IMPORTANCE_OPTIONS;
    readonly statusOptions = STATUS_OPTIONS;
    readonly colorPresets = COLOR_PRESETS;

    readonly dayOptions = computed(() => {
        if (!this.editedEvent) return [];
        const cal = this.calendar();
        const month = cal.months[this.editedEvent.date.monthIndex];
        const days = getDaysInMonth(month, this.editedEvent.date.year);

        return Array.from({ length: days }, (_, i) => ({
            label: `Day ${i + 1}`,
            value: i
        }));
    });

    updateMonth(monthIndex: number) {
        if (!this.editedEvent) return;
        this.editedEvent.date.monthIndex = Number(monthIndex);
        // Ensure day index is valid for new month
        const maxDays = getDaysInMonth(this.calendar().months[monthIndex], this.editedEvent.date.year);
        if (this.editedEvent.date.dayIndex >= maxDays) {
            this.editedEvent.date.dayIndex = maxDays - 1;
        }
    }

    handleSave() {
        if (this.editedEvent) {
            this.calendarService.updateEvent(this.editedEvent.id, this.editedEvent);
            this.onClose();
        }
    }

    handleDelete() {
        if (this.editedEvent && confirm('Are you sure you want to delete this event?')) {
            this.calendarService.removeEvent(this.editedEvent.id);
            this.onClose();
        }
    }

    onClose() {
        this.visible = false;
        this.visibleChange.emit(false);
        this.calendarService.highlightedEventId.set(null); // Clear selection in service context if used
    }
}
