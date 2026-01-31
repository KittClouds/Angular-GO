import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from './blueprint-hub.service';
import { ButtonModule } from 'primeng/button';
import { GraphTabComponent } from './tabs/graph-tab/graph-tab.component';
import { ThemeTabComponent } from './tabs/theme-tab/theme-tab.component';
import { PatternsTabComponent } from './tabs/patterns-tab/patterns-tab.component';
import { StoryBeatsTabComponent } from './tabs/story-beats-tab/story-beats-tab.component';
import { WorldbuildingTabComponent } from './tabs/worldbuilding-tab/worldbuilding-tab.component';

@Component({
    selector: 'app-blueprint-hub',
    standalone: true,
    imports: [
        CommonModule,
        ButtonModule,
        GraphTabComponent,
        ThemeTabComponent,
        PatternsTabComponent,
        StoryBeatsTabComponent,
        WorldbuildingTabComponent
    ],
    templateUrl: './blueprint-hub.component.html',
    styleUrl: './blueprint-hub.component.css'
})
export class BlueprintHubComponent {
    activeTab = 'graph';

    // Resize state
    hubHeight = 600; // Default height in pixels
    private isResizing = false;
    private startY = 0;
    private startHeight = 0;

    tabs = [
        { id: 'graph', label: 'Graph', icon: 'pi pi-share-alt' },
        { id: 'theme', label: 'Theme', icon: 'pi pi-palette' },
        { id: 'patterns', label: 'Patterns', icon: 'pi pi-code' },
        { id: 'story-beats', label: 'Story Beats', icon: 'pi pi-video' },
        { id: 'worldbuilding', label: 'Worldbuilding', icon: 'pi pi-globe' },
        { id: 'attributes', label: 'Attributes', icon: 'pi pi-database' },
    ];

    constructor(public hubService: BlueprintHubService) { }

    setActiveTab(tabId: string) {
        this.activeTab = tabId;
    }

    get activeTabIcon(): string {
        const t = this.tabs.find(x => x.id === this.activeTab);
        return t ? t.icon : 'pi pi-info-circle';
    }

    get activeTabLabel(): string {
        const t = this.tabs.find(x => x.id === this.activeTab);
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
