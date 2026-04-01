// @vitest-environment jsdom
import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed, getTestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SliderManagerComponent } from './slider-manager.component';
import { CustomSliderService } from '../services/custom-slider.service';
import { FactSheetService } from '../fact-sheet.service';
import { ScopeService } from '../../../lib/services/scope.service';

try {
    getTestBed().initTestEnvironment(
        BrowserDynamicTestingModule,
        platformBrowserDynamicTesting(),
    );
} catch {
    // Test environment already initialized for this Vitest worker.
}

describe('SliderManagerComponent accessibility markup', () => {
    let customSliderServiceMock: {
        getForEntityKind: ReturnType<typeof vi.fn>;
        reorderSliders: ReturnType<typeof vi.fn>;
        createSlider: ReturnType<typeof vi.fn>;
        updateUmbra: ReturnType<typeof vi.fn>;
        deleteSlider: ReturnType<typeof vi.fn>;
    };
    let factSheetServiceMock: {
        loadAttributes: ReturnType<typeof vi.fn>;
        setAttribute: ReturnType<typeof vi.fn>;
    };
    let scopeServiceMock: {
        resolvedScope: ReturnType<typeof signal>;
    };

    beforeEach(async () => {
        customSliderServiceMock = {
            getForEntityKind: vi.fn().mockResolvedValue([]),
            reorderSliders: vi.fn().mockResolvedValue(undefined),
            createSlider: vi.fn().mockResolvedValue(undefined),
            updateUmbra: vi.fn().mockResolvedValue(undefined),
            deleteSlider: vi.fn().mockResolvedValue(true),
        };
        factSheetServiceMock = {
            loadAttributes: vi.fn().mockResolvedValue({}),
            setAttribute: vi.fn().mockResolvedValue(undefined),
        };
        scopeServiceMock = {
            resolvedScope: signal({ scopeFolderId: 'vault:global' }),
        };

        await TestBed.configureTestingModule({
            imports: [SliderManagerComponent],
            providers: [
                { provide: CustomSliderService, useValue: customSliderServiceMock },
                { provide: FactSheetService, useValue: factSheetServiceMock },
                { provide: ScopeService, useValue: scopeServiceMock },
            ],
        }).compileComponents();
    });

    it('adds ids, names, and label bindings for always-visible and add-form inputs', async () => {
        const fixture = TestBed.createComponent(SliderManagerComponent);
        fixture.componentInstance.entityKind = 'CHARACTER';
        fixture.componentInstance.entityId = 'entity-kai';
        fixture.detectChanges(false);
        await fixture.whenStable();
        fixture.detectChanges(false);

        const component = fixture.componentInstance;
        const host = fixture.nativeElement as HTMLElement;

        const statusId = component.getInputId('status-conditions');
        const statusLabel = host.querySelector(`label[for="${statusId}"]`);
        const statusInput = host.querySelector(`input#${statusId}`);
        expect(statusLabel?.textContent).toContain('Status Conditions');
        expect(readInputName(statusInput)).toBe(component.getInputName('status-conditions'));

        const addButton = Array.from(host.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Add Stat'));
        addButton?.click();
        fixture.detectChanges(false);
        await fixture.whenStable();
        fixture.detectChanges(false);
        fixture.detectChanges(false);

        const statNameId = component.getInputId('new-stat-name');
        const statNameLabel = host.querySelector(`label[for="${statNameId}"]`);
        const statNameInput = host.querySelector('input[placeholder*="Sanity, Corruption, Renown"]');
        expect(statNameLabel?.textContent).toContain('Stat Name');
        expect((statNameInput as HTMLInputElement | null)?.id).toBe(statNameId);
        expect(readInputName(statNameInput)).toBe(component.getInputName('new-stat-name'));
    });

    function readInputName(element: Element | null): string | null {
        if (!element) {
            return null;
        }

        return element.getAttribute('name') || (element as HTMLInputElement).name || null;
    }
});
