import { Routes } from '@angular/router';
import { FantasyCalendarPageComponent } from './pages/fantasy-calendar/fantasy-calendar-page.component';
import { EditorComponent } from './components/editor/editor.component';

export const routes: Routes = [
    { path: '', component: EditorComponent },
    { path: 'calendar', component: FantasyCalendarPageComponent },
    { path: 'test/graph', loadComponent: () => import('./test/gokitt-graph-test.component').then(m => m.GokittGraphTestComponent) }
];
