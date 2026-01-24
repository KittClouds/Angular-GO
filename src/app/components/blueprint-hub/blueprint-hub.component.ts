import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from './blueprint-hub.service';
import { ButtonModule } from 'primeng/button';
import { GraphTabComponent } from './tabs/graph-tab/graph-tab.component';
import { ThemeTabComponent } from './tabs/theme-tab/theme-tab.component';

@Component({
    selector: 'app-blueprint-hub',
    standalone: true,
    imports: [CommonModule, ButtonModule, GraphTabComponent, ThemeTabComponent],
    templateUrl: './blueprint-hub.component.html',
    styleUrl: './blueprint-hub.component.css'
})
export class BlueprintHubComponent {
    activeTab = 'graph';

    tabs = [
        { id: 'graph', label: 'Graph', icon: 'pi pi-share-alt' },
        { id: 'theme', label: 'Theme', icon: 'pi pi-palette' },
        { id: 'patterns', label: 'Patterns', icon: 'pi pi-code' },
        { id: 'fields', label: 'Fields', icon: 'pi pi-tags' },
        { id: 'attributes', label: 'Attributes', icon: 'pi pi-database' },
        { id: 'views', label: 'Views', icon: 'pi pi-eye' },
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
}
