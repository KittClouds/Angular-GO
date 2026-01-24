import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class BlueprintHubService {
    isHubOpen = signal(false);

    toggle() {
        this.isHubOpen.update(v => !v);
    }

    close() {
        this.isHubOpen.set(false);
    }

    open() {
        this.isHubOpen.set(true);
    }
}
