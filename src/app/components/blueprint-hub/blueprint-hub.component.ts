import { Component, HostListener, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from './blueprint-hub.service';
import { GraphTabComponent } from './tabs/graph-tab/graph-tab.component';
import { PatternsTabComponent } from './tabs/patterns-tab/patterns-tab.component';
import { PlotThreadsTabComponent } from './tabs/plot-threads-tab/plot-threads-tab.component';
import { WorldbuildingTabComponent } from './tabs/worldbuilding-tab/worldbuilding-tab.component';
import { getSetting, setSetting } from '../../lib/dexie/settings.service';

const STORAGE_KEY = 'kittclouds-hub-tab';
const VALID_TAB_IDS = ['graph', 'patterns', 'plot-threads', 'worldbuilding', 'attributes'];

@Component({
    selector: 'app-blueprint-hub',
    standalone: true,
    imports: [
        CommonModule,
        GraphTabComponent,
        PatternsTabComponent,
        PlotThreadsTabComponent,
        WorldbuildingTabComponent
    ],
    templateUrl: './blueprint-hub.component.html',
    styleUrl: './blueprint-hub.component.css'
})
export class BlueprintHubComponent {
    // Local state with Dexie settings persistence
    private _activeTab = signal(this.loadFromStorage());

    // Active tab (signal)
    activeTab = computed(() => this._activeTab());

    // Resize state
    hubHeight = 600; // Default height in pixels
    private isResizing = false;
    private startY = 0;
    private startHeight = 0;

    tabs = [
        { id: 'graph', label: 'Graph', icon: 'pi pi-share-alt' },
        { id: 'patterns', label: 'Patterns', icon: 'pi pi-code' },
        { id: 'plot-threads', label: 'Plot Threads', icon: 'pi pi-sitemap' },
        { id: 'worldbuilding', label: 'Worldbuilding', icon: 'pi pi-globe' },
        { id: 'attributes', label: 'Attributes', icon: 'pi pi-database' },
    ];

    constructor(public hubService: BlueprintHubService) { }

    private loadFromStorage(): string {
        const stored = getSetting<string | null>(STORAGE_KEY, null);
        if (stored && VALID_TAB_IDS.includes(stored)) return stored;
        return 'graph';
    }

    setActiveTab(tabId: string) {
        this._activeTab.set(tabId);
        setSetting(STORAGE_KEY, tabId);
    }

    get activeTabIcon(): string {
        const t = this.tabs.find(x => x.id === this.activeTab());
        return t ? t.icon : 'pi pi-info-circle';
    }

    get activeTabLabel(): string {
        const t = this.tabs.find(x => x.id === this.activeTab());
        return t ? t.label : '';
    }

    // Resize Logic
    startResize(event: MouseEvent) {
        event.preventDefault();
        this.isResizing = true;
        this.startY = event.clientY;
        this.startHeight = this.hubHeight;

        // Add cursor style to body to prevent flickering during quick drags
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    }

    @HostListener('window:mousemove', ['$event'])
    onMouseMove(event: MouseEvent) {
        if (!this.isResizing) return;

        // Calculate delta: moving UP (smaller Y) means LARGER height
        const delta = this.startY - event.clientY;
        const newHeight = this.startHeight + delta;

        // Constraints
        const minHeight = 200;
        const maxHeight = window.innerHeight - 100; // Leave some space at top

        this.hubHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);
    }

    @HostListener('window:mouseup')
    onMouseUp() {
        if (this.isResizing) {
            this.isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }
}
