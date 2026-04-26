// @vitest-environment jsdom
import '@angular/compiler';
import { Component, Input } from '@angular/core';
import { TestBed, getTestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FactSheetContainerComponent, ParsedEntity } from './fact-sheet-container.component';
import { CardWithFields, FactSheetService } from '../fact-sheet.service';
import { FactSheetFieldSchema } from '../../../lib/dexie/db';
import { FactSheetCardComponent } from '../fact-sheet-card/fact-sheet-card.component';

try {
    getTestBed().initTestEnvironment(
        BrowserDynamicTestingModule,
        platformBrowserDynamicTesting(),
    );
} catch {
    // Test environment already initialized for this Vitest worker.
}

@Component({
    selector: 'app-fact-sheet-card',
    standalone: true,
    template: `<ng-content />`,
})
class StubFactSheetCardComponent {
    @Input() title = '';
    @Input() icon = '';
    @Input() gradientCss = '';
}

describe('FactSheetContainerComponent accessibility markup', () => {
    const entity: ParsedEntity = {
        id: 'entity-kai',
        kind: 'CHARACTER',
        label: 'Kai',
    };

    let factSheetServiceMock: {
        getCardsSync: ReturnType<typeof vi.fn>;
        loadAttributes: ReturnType<typeof vi.fn>;
        setAttribute: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        factSheetServiceMock = {
            getCardsSync: vi.fn(),
            loadAttributes: vi.fn().mockResolvedValue({}),
            setAttribute: vi.fn().mockResolvedValue(undefined),
        };

        TestBed.overrideComponent(FactSheetContainerComponent, {
            remove: {
                imports: [FactSheetCardComponent],
            },
            add: {
                imports: [StubFactSheetCardComponent],
            },
        });

        await TestBed.configureTestingModule({
            imports: [FactSheetContainerComponent, NoopAnimationsModule],
            providers: [
                { provide: FactSheetService, useValue: factSheetServiceMock },
            ],
        }).compileComponents();
    });

    it('associates direct labels with number, dropdown, and array controls', async () => {
        const fields: FactSheetFieldSchema[] = [
            createField('age', 'number', 'Age'),
            createField('role', 'dropdown', 'Role', { options: JSON.stringify(['Mage', 'Scout']) }),
            createField('aliases', 'array', 'Aliases'),
            createField('relationships', 'relationship', 'Connections'),
        ];
        const { fixture, component } = await renderComponent(fields);
        const host = fixture.nativeElement as HTMLElement;

        const ageInputId = component.getFieldControlId('identity', 'age');
        const ageLabel = host.querySelector(`label[for="${ageInputId}"]`);
        const ageInput = host.querySelector(`input#${ageInputId}`);
        expect(ageLabel?.textContent).toContain('Age');
        expect(readControlName(ageInput)).toBe(component.getFieldControlName('identity', 'age'));

        const roleInputId = component.getFieldControlId('identity', 'role');
        const roleLabel = host.querySelector(`label[for="${roleInputId}"]`);
        const roleInput = host.querySelector(`select#${roleInputId}`);
        expect(roleLabel?.textContent).toContain('Role');
        expect(readControlName(roleInput)).toBe(component.getFieldControlName('identity', 'role'));

        const aliasesInputId = component.getFieldControlId('identity', 'aliases');
        const aliasesLabel = host.querySelector(`label[for="${aliasesInputId}"]`);
        const aliasesInput = host.querySelector(`input#${aliasesInputId}`);
        expect(aliasesLabel?.textContent).toContain('Aliases');
        expect(readControlName(aliasesInput)).toBe(component.getFieldControlName('identity', 'aliases'));

        const relationshipLabelId = component.getFieldLabelId('identity', 'relationships');
        expect(host.querySelector(`span#${relationshipLabelId}`)?.textContent).toContain('Connections');
        expect(host.querySelector(`label#${relationshipLabelId}`)).toBeNull();
    });

    it('assigns stable ids and names to text editors when they are activated', async () => {
        const fields: FactSheetFieldSchema[] = [
            createField('fullName', 'text', 'Full Name'),
            createField('background', 'text', 'Background'),
        ];
        const { fixture, component } = await renderComponent(fields, {
            fullName: 'Kai Velorum',
            background: 'A long background field.',
        });
        const host = fixture.nativeElement as HTMLElement;

        component.editingField.set('fullName');
        fixture.detectChanges(false);
        await fixture.whenStable();
        fixture.detectChanges(false);

        const fullNameInputId = component.getFieldControlId('identity', 'fullName');
        const fullNameInput = host.querySelector(`input#${fullNameInputId}`);
        expect(readControlName(fullNameInput)).toBe(component.getFieldControlName('identity', 'fullName'));
        expect(fullNameInput?.getAttribute('aria-labelledby')).toBe(component.getFieldLabelId('identity', 'fullName'));

        component.editingField.set('background');
        fixture.detectChanges(false);
        await fixture.whenStable();
        fixture.detectChanges(false);

        const backgroundInputId = component.getFieldControlId('identity', 'background');
        const backgroundInput = host.querySelector(`textarea#${backgroundInputId}`);
        expect(readControlName(backgroundInput)).toBe(component.getFieldControlName('identity', 'background'));
        expect(backgroundInput?.getAttribute('aria-labelledby')).toBe(component.getFieldLabelId('identity', 'background'));
    });

    it('uses aria-labelledby for progress sliders and stat knobs instead of stray labels', async () => {
        const fields: FactSheetFieldSchema[] = [
            createField('health', 'progress', 'Health', {
                currentField: 'healthCurrent',
                maxField: 'healthMax',
            }),
            createField('stats', 'stat-grid', 'Core Stats', {
                stats: JSON.stringify([
                    { name: 'strength', label: 'Strength', abbr: 'STR' },
                ]),
            }),
        ];
        const { fixture, component } = await renderComponent(fields, {
            healthCurrent: 42,
            healthMax: 100,
            stats: { strength: 12 },
        });
        const host = fixture.nativeElement as HTMLElement;

        const healthLabelId = component.getFieldLabelId('identity', 'health');
        expect(host.querySelector(`span#${healthLabelId}`)?.textContent).toContain('Health');
        expect(host.querySelector(`[role="slider"][aria-labelledby="${healthLabelId}"]`)).not.toBeNull();

        const statLabelId = component.getStatLabelId('identity', 'stats', 'strength');
        const statSlider = host.querySelector(`svg[role="slider"][aria-labelledby="${statLabelId}"]`);
        expect(host.querySelector(`#${statLabelId}`)?.textContent).toContain('STR');
        expect(statSlider?.getAttribute('aria-label')).toBe('Strength');
    });

    async function renderComponent(fields: FactSheetFieldSchema[], attrs: Record<string, unknown> = {}) {
        factSheetServiceMock.getCardsSync.mockReturnValue([createCard(fields)]);
        factSheetServiceMock.loadAttributes.mockResolvedValue(attrs);

        const fixture = TestBed.createComponent(FactSheetContainerComponent);
        const component = fixture.componentInstance;

        (component as any).entity = () => entity;
        (component as any).contextId = () => 'global';
        component.orderedCards.set([createCard(fields)]);
        (component as any).loadAttributesIntoModels(attrs);

        fixture.detectChanges(false);
        await fixture.whenStable();
        fixture.detectChanges(false);

        return { fixture, component };
    }

    function readControlName(element: Element | null): string | null {
        if (!element) {
            return null;
        }

        return element.getAttribute('name')
            || ((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).name || null);
    }

    function createCard(fields: FactSheetFieldSchema[]): CardWithFields {
        return {
            schema: {
                id: 'CHARACTER::identity',
                entityKind: 'CHARACTER',
                cardId: 'identity',
                title: 'Identity',
                icon: 'User',
                gradient: 'from-blue-500 to-cyan-500',
                displayOrder: 0,
                isSystem: true,
                createdAt: 0,
                updatedAt: 0,
            },
            fields,
            gradientCss: 'linear-gradient(to right, #3b82f6, #06b6d4)',
        };
    }

    function createField(
        fieldName: string,
        fieldType: string,
        label: string,
        overrides: Partial<FactSheetFieldSchema> = {},
    ): FactSheetFieldSchema {
        return {
            id: `CHARACTER::identity::${fieldName}`,
            entityKind: 'CHARACTER',
            cardId: 'identity',
            fieldName,
            fieldType,
            label,
            displayOrder: 0,
            isSystem: true,
            createdAt: 0,
            updatedAt: 0,
            ...overrides,
        };
    }
});
