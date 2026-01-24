import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import { HeaderComponent } from '../../header/header.component';
import { HubFooterComponent } from '../../blueprint-hub/hub-footer/hub-footer.component';
import { BlueprintHubComponent } from '../../blueprint-hub/blueprint-hub.component';
import { SidebarComponent } from '../../sidebar/sidebar.component';

@Component({
    selector: 'app-main-layout',
    standalone: true,
    imports: [CommonModule, HeaderComponent, HubFooterComponent, BlueprintHubComponent, SidebarComponent],
    templateUrl: './main-layout.component.html',
    styleUrls: ['./main-layout.component.css']
})
export class MainLayoutComponent {
}

