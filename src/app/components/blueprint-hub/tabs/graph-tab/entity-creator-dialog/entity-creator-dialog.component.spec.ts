import '@angular/compiler';
import { SimpleChange } from '@angular/core';
import { describe, expect, it } from 'vitest';

import { EntityCreatorDialogComponent } from './entity-creator-dialog.component';

describe('EntityCreatorDialogComponent', () => {
    it('keeps non-standard kinds visible when editing an existing entity', () => {
        const component = new EntityCreatorDialogComponent();
        component.editEntity = {
            id: 'entity-1',
            label: 'Kai',
            kind: 'OTHER',
            aliases: [],
        };
        component.visible = true;

        component.ngOnChanges({
            editEntity: new SimpleChange(undefined, component.editEntity, true),
            visible: new SimpleChange(false, true, true),
        });

        expect(component.allKinds).toContain('OTHER');
        expect(component.selectedKind()).toBe('OTHER');
        expect(component.label).toBe('Kai');
    });
});
