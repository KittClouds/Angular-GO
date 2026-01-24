import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from '../blueprint-hub.service';

@Component({
    selector: 'app-hub-footer',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './hub-footer.component.html',
    styleUrl: './hub-footer.component.css' // Note: Angular 17+ defaults to styleUrl (singular)
})
export class HubFooterComponent {

    constructor(public hubService: BlueprintHubService) { }

}
