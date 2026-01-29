import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlueprintHubService } from '../blueprint-hub.service';
import { FooterStatsService } from '../../../services/footer-stats.service';
import { ScopeIndicatorComponent } from './scope-indicator.component';

@Component({
    selector: 'app-hub-footer',
    standalone: true,
    imports: [CommonModule, ScopeIndicatorComponent],
    templateUrl: './hub-footer.component.html',
    styleUrl: './hub-footer.component.css'
})
export class HubFooterComponent {
    hubService = inject(BlueprintHubService);
    statsService = inject(FooterStatsService);
}
