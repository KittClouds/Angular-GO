import { Routes } from '@angular/router';
import { FantasyCalendarPageComponent } from './pages/fantasy-calendar/fantasy-calendar-page.component';
import { EditorComponent } from './components/editor/editor.component';
import { GraphPageComponent } from './pages/graph/graph-page.component';

export const routes: Routes = [
    { path: '', component: EditorComponent },
    { path: 'calendar', component: FantasyCalendarPageComponent },
    { path: 'graph', component: GraphPageComponent },
    { path: 'chat', loadComponent: () => import('./pages/ai-chat/ai-chat-page.component').then(m => m.AiChatPageComponent) },
    { path: 'test/graph', loadComponent: () => import('./test/gokitt-graph-test.component').then(m => m.GokittGraphTestComponent) },
    { path: 'playground', loadComponent: () => import('./pages/playground/playground-page.component').then(m => m.PlaygroundPageComponent) },
    { path: 'raptor-eval', redirectTo: 'playground', pathMatch: 'full' },
];
