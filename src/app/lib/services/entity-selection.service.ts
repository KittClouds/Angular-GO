import { Injectable, signal } from '@angular/core';

import { getSetting, setSetting } from '../dexie/settings.service';

const ENTITY_STORAGE_KEY = 'right-sidebar:selected-entity';

@Injectable({ providedIn: 'root' })
export class EntitySelectionService {
    readonly selectedEntityId = signal(getSetting<string>(ENTITY_STORAGE_KEY, ''));

    select(entityId: string): void {
        this.selectedEntityId.set(entityId);
        setSetting(ENTITY_STORAGE_KEY, entityId);
    }

    clear(): void {
        this.select('');
    }

    ensureValid(entityIds: readonly string[]): void {
        const current = this.selectedEntityId();
        if (entityIds.length === 0) {
            if (current) this.clear();
            return;
        }
        if (!entityIds.includes(current)) {
            this.select(entityIds[0]);
        }
    }
}
