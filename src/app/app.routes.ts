import { Routes } from '@angular/router';
import { FantasyCalendarPageComponent } from './pages/fantasy-calendar/fantasy-calendar-page.component';
import { EditorComponent } from './components/editor/editor.component';
import { GraphPageComponent } from './pages/graph/graph-page.component';

export const routes: Routes = [
    { path: '', component: EditorComponent },
    { path: 'calendar', component: FantasyCalendarPageComponent },
    { path: 'graph', component: GraphPageComponent },
    { path: 'test/graph', loadComponent: () => import('./test/gokitt-graph-test.component').then(m => m.GokittGraphTestComponent) },
    { path: 'raptor-eval', loadComponent: () => import('./components/raptor-eval').then(m => m.RaptorEvalComponent) }
];
