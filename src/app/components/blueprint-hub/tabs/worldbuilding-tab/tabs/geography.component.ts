import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-geography',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="flex flex-col items-center justify-center h-full text-zinc-500 p-12">
      <i class="pi pi-map text-4xl mb-4 opacity-50"></i>
      <h3 class="text-xl font-medium mb-2">Geography & Ecosystems</h3>
      <p>Under Construction</p>
    </div>
  `
})
export class GeographyComponent { }
