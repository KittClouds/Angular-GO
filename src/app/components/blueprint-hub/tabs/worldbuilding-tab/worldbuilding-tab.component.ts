import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WorldHomeComponent } from './world-home.component';

@Component({
    selector: 'app-worldbuilding-tab',
    standalone: true,
    imports: [WorldHomeComponent],
    templateUrl: './worldbuilding-tab.component.html',
    styles: [':host { display: block; height: 100%; }'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorldbuildingTabComponent { }
