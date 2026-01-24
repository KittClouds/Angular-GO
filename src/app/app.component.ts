import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainLayoutComponent } from './components/layout/main-layout/main-layout.component';
import { EditorComponent } from './components/editor/editor.component';
import { smartGraphRegistry } from './lib/registry';
import { entityColorStore } from './lib/store/entityColorStore';
import { seedDefaultSchemas } from './lib/folders/seed';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MainLayoutComponent, EditorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'angular-notes';

  ngOnInit() {
    // Initialize entity color CSS variables
    entityColorStore.initialize();

    // Seed default folder/network schemas
    seedDefaultSchemas()
      .then(() => console.log('[AppComponent] Schema seeding complete'))
      .catch(err => console.error('[AppComponent] Schema seeding failed:', err));

    console.log('[AppComponent] Initializing smartGraphRegistry...');
    smartGraphRegistry.init().catch(err => console.error('[AppComponent] Registry init failed:', err));
  }
}

