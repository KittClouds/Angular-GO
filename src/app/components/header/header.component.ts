import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    LucideAngularModule,
    Undo,
    Redo,
    PanelLeft,
    PanelRight
} from 'lucide-angular';
import { EditorService } from '../../services/editor.service';
import { SidebarService } from '../../lib/services/sidebar.service';
import { RightSidebarService } from '../../lib/services/right-sidebar.service';

@Component({
    selector: 'app-header',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.css']
})
export class HeaderComponent {
    readonly Undo = Undo;
    readonly Redo = Redo;
    readonly PanelLeft = PanelLeft;
    readonly PanelRight = PanelRight;

    sidebarService = inject(SidebarService);
    rightSidebarService = inject(RightSidebarService);

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
}
