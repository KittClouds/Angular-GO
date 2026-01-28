import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainLayoutComponent } from './components/layout/main-layout/main-layout.component';
import { NgxSpinnerModule, NgxSpinnerService } from 'ngx-spinner';

import { smartGraphRegistry } from './lib/registry';
import { entityColorStore } from './lib/store/entityColorStore';
import { seedDefaultSchemas } from './lib/folders/seed';
import { GoKittService } from './services/gokitt.service';
import { setGoKittService } from './api/highlighter-api';
import { AppOrchestrator, setAppOrchestrator } from './lib/core/app-orchestrator';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MainLayoutComponent, NgxSpinnerModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'angular-notes';
  private spinner = inject(NgxSpinnerService);
  private goKitt = inject(GoKittService);
  private orchestrator = inject(AppOrchestrator);

  async ngOnInit() {
    // Phase 0: Shell - spinner visible
    this.spinner.show();

    // Export orchestrator for non-DI contexts
    setAppOrchestrator(this.orchestrator);

    // Wire up GoKitt to Highlighter API (doesn't start WASM yet)
    setGoKittService(this.goKitt);

    // Initialize entity color CSS variables (sync, no deps)
    entityColorStore.initialize();

    console.log('[AppComponent] Starting orchestrated boot...');

    try {
      // Phase 1: Data Layer - Dexie + Seed
      await seedDefaultSchemas();
      console.log('[AppComponent] ✓ Seed complete');
      this.orchestrator.completePhase('data_layer');

      // Phase 2: Registry - hydrate from Dexie (parallel with WASM load)
      const registryPromise = smartGraphRegistry.init().then(() => {
        console.log('[AppComponent] ✓ SmartGraphRegistry hydrated');
        this.orchestrator.completePhase('registry');
      });

      // Phase 3: WASM Load - load module (parallel with registry)
      const wasmLoadPromise = this.goKitt.loadWasm().then(() => {
        console.log('[AppComponent] ✓ WASM module loaded');
        this.orchestrator.completePhase('wasm_load');
      });

      // Wait for both registry AND wasm to be ready
      await Promise.all([registryPromise, wasmLoadPromise]);

      // Phase 4: WASM Hydrate - pass entities to GoKitt
      await this.goKitt.hydrateWithEntities();
      console.log('[AppComponent] ✓ WASM hydrated with entities');
      this.orchestrator.completePhase('wasm_hydrate');

      // Phase 5: Ready
      this.orchestrator.completePhase('ready');

    } catch (err) {
      console.error('[AppComponent] Boot failed:', err);
    } finally {
      // Minimum display time for spinner
      await new Promise(resolve => setTimeout(resolve, 300));
      this.spinner.hide();
    }
  }
}
