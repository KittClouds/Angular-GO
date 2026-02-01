
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';


// Domain Components
import { WorldOverviewComponent } from './tabs/world-overview.component';
import { GeographyComponent } from './tabs/geography.component';
import { CulturesComponent } from './tabs/cultures.component'; // Updated
import { MagicSystemComponent } from './tabs/magic-system.component';
import { ReligionComponent } from './tabs/religion.component';
import { PoliticsComponent } from './tabs/politics.component';
import { ArtsComponent } from './tabs/arts.component';

export type WorldBuildingTabId = 'overview' | 'geography' | 'culture' | 'magic' | 'religion' | 'politics' | 'arts';

interface TabDef {
    id: WorldBuildingTabId;
    label: string;
    icon: string; // PrimeIcons class
}

@Component({
    selector: 'app-worldbuilding-tab',
    standalone: true,
    imports: [
        CommonModule,
        ButtonModule,
        WorldOverviewComponent,
        GeographyComponent,
        CulturesComponent, // Updated
        MagicSystemComponent,
        ReligionComponent,
        PoliticsComponent,
        ArtsComponent
    ],
    templateUrl: './worldbuilding-tab.component.html',
    styles: [`
        :host { display: block; height: 100%; }
    `]
})
export class WorldbuildingTabComponent implements OnInit {

    // Tab Definitions
    tabs: TabDef[] = [
        { id: 'overview', label: 'Overview', icon: 'pi pi-globe' },
        { id: 'geography', label: 'Geography', icon: 'pi pi-map' },
        { id: 'culture', label: 'Cultures', icon: 'pi pi-users' }, // Label updated slightly
        { id: 'magic', label: 'Magic', icon: 'pi pi-bolt' },
        { id: 'religion', label: 'Religion', icon: 'pi pi-book' },
        { id: 'politics', label: 'Politics', icon: 'pi pi-sitemap' },
        { id: 'arts', label: 'Arts', icon: 'pi pi-palette' },
    ];

    // State
    activeTabId = signal<WorldBuildingTabId>('overview');

    constructor() { }

    ngOnInit() {
        // Future: Check query params or local storage to restore active tab
    }

    setActiveTab(id: WorldBuildingTabId) {
        this.activeTabId.set(id);
    }
}
