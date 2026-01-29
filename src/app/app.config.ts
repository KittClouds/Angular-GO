import { ApplicationConfig, provideBrowserGlobalErrorListeners, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeng/themes/aura';
import { LucideAngularModule, User, Zap, BarChart3, Sparkles, Package, Users, StickyNote, ChevronDown, Circle, GripVertical, FileQuestion, Search, Settings, Home, Plus, X, Trash2, Edit2, Save, Clock } from 'lucide-angular';
import { NgxSpinnerModule } from 'ngx-spinner';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimations(),
    providePrimeNG({
      theme: {
        preset: Aura
      }
    }),
    importProvidersFrom(
      LucideAngularModule.pick({
        User, Zap, BarChart3, Sparkles, Package, Users, StickyNote, ChevronDown, Circle, GripVertical, FileQuestion,
        Search, Settings, Home, Plus, X, Trash2, Edit2, Save, Clock
      }),
      NgxSpinnerModule.forRoot({ type: 'ball-zig-zag-deflect' })
    )
  ]
};
