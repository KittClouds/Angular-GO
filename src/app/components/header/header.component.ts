import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    LucideAngularModule,
    Undo,
    Redo,
    PanelLeft
} from 'lucide-angular';
import { EditorService } from '../../services/editor.service';
import { SidebarService } from '../../lib/services/sidebar.service';

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

    sidebarService = inject(SidebarService);

    constructor(private editorService: EditorService) { }

    toggleSidebar() {
        this.sidebarService.toggle();
    }

    undo() {
        this.editorService.undo();
    }

    redo() {
        this.editorService.redo();
    }
}
