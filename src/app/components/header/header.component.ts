import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    LucideAngularModule,
    Undo,
    Redo,
    PanelLeft,
    PanelRight,
    Sun,
    Moon,
    History
} from 'lucide-angular';
import { EditorService } from '../../services/editor.service';
import { SidebarService } from '../../lib/services/sidebar.service';
import { RightSidebarService } from '../../lib/services/right-sidebar.service';
import { ThemeService } from '../../lib/services/theme.service';
import { BlueprintHubService } from '../blueprint-hub/blueprint-hub.service';

import { EditorTabsComponent } from './editor-tabs/editor-tabs.component';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, EditorTabsComponent],
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css']
})
export class HeaderComponent {
    readonly Undo = Undo;
    readonly Redo = Redo;
    readonly PanelLeft = PanelLeft;
    readonly PanelRight = PanelRight;
    readonly Sun = Sun;
    readonly Moon = Moon;
    readonly History = History;

    sidebarService = inject(SidebarService);
    rightSidebarService = inject(RightSidebarService);
    themeService = inject(ThemeService);
    hubService = inject(BlueprintHubService);

    constructor(private editorService: EditorService) { }

    toggleSidebar() {
        this.sidebarService.toggleClose();
    }

    undo() {
        this.editorService.undo();
    }

    redo() {
        this.editorService.redo();
    }

    openNoteHistory() {
        this.rightSidebarService.open();
        this.rightSidebarService.setActivePanel('history');
    }
}
