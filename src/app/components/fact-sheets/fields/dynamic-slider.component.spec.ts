// @vitest-environment jsdom
import '@angular/compiler';
import { TestBed, getTestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DynamicSliderComponent } from './dynamic-slider.component';
import { CustomSliderDef } from '../../../lib/dexie/db';

try {
    getTestBed().initTestEnvironment(
        BrowserDynamicTestingModule,
        platformBrowserDynamicTesting(),
    );
} catch {
    // Test environment already initialized for this Vitest worker.
}

describe('DynamicSliderComponent accessibility markup', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DynamicSliderComponent],
        }).compileComponents();
    });

    it('wires the hidden range input to a stable label, id, and name', async () => {
        const fixture = TestBed.createComponent(DynamicSliderComponent);
        fixture.componentRef.setInput('slider', createSlider());
        fixture.componentRef.setInput('currentValue', 42);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const component = fixture.componentInstance;
        const host = fixture.nativeElement as HTMLElement;

        const labelId = component.sliderLabelId();
        const inputId = component.sliderInputId();
        const input = host.querySelector(`input#${inputId}`);

        expect(host.querySelector(`span#${labelId}`)?.textContent).toContain('Sanity');
        expect(input?.getAttribute('name')).toBe(component.sliderInputName());
        expect(input?.getAttribute('aria-labelledby')).toBe(labelId);
        expect(input?.getAttribute('aria-label')).toBe('Sanity');
    });

    function createSlider(): CustomSliderDef {
        return {
            id: 'slider-sanity',
            entityKind: 'CHARACTER',
            name: 'sanity',
            label: 'Sanity',
            colorLow: '#ef4444',
            colorMid: '#f59e0b',
            colorHigh: '#22c55e',
            umbraPreset: 'corruption',
            min: 0,
            max: 100,
            icon: 'Activity',
            isSystem: false,
            displayOrder: 0,
            createdAt: 0,
            updatedAt: 0,
        };
    }
});
