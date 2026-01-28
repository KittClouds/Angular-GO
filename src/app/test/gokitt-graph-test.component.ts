import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoKittService } from '../services/gokitt.service';
import { smartGraphRegistry } from '../lib/registry';

@Component({
    selector: 'app-gokitt-graph-test',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './gokitt-graph-test.component.html',
    styles: [`
    .container { padding: 20px; font-family: monospace; color: #eee; background-color: #1e1e1e; min-height: 100vh; }
    .section { margin-bottom: 20px; border: 1px solid #333; padding: 10px; border-radius: 4px; background-color: #252526; }
    h1, h2, h3 { color: #4ade80; }
    h4 { color: #60a5fa; margin-bottom: 5px; }
    pre { background: #111; color: #eee; padding: 10px; overflow: auto; max-height: 400px; border: 1px solid #444; border-radius: 4px; font-size: 12px; }
    .success { color: #4ade80; }
    .error { color: #ef4444; }
    button { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s; margin-right: 10px; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #555; cursor: not-allowed; }
    .input-text { font-style: italic; color: #aaa; margin-bottom: 15px; display: block; padding: 10px; background: #333; border-radius: 4px; }
    .kv-pair { display: flex; justify-content: space-between; border-bottom: 1px solid #333; padding: 4px 0; }
  `]
})
export class GokittGraphTestComponent implements OnInit {
    status = 'Initializing...';
    scanResult: any = null;
    // Use a text that is guaranteed to have SVO structure
    sampleText = "Gandalf said to Frodo that the ring is dangerous. The hobbit looked at the wizard with fear.";

    constructor(private goKitt: GoKittService) { }

    async ngOnInit() {
        this.status = 'Waiting for GoKitt WASM...';

        // Check if already ready
        if (this.goKitt.isReady) {
            await this.seedAndReady();
        } else {
            this.goKitt.onReady(async () => {
                await this.seedAndReady();
            });
        }
    }

    async seedAndReady() {
        this.status = 'Seeding entities...';

        try {
            // Seed Gandalf and Frodo as CHARACTERS so WASM Dictionary knows them
            // Use type assertion as EntityKind might strictly be typed
            smartGraphRegistry.registerEntity('Gandalf', 'CHARACTER' as any, 'test-note');
            smartGraphRegistry.registerEntity('Frodo', 'CHARACTER' as any, 'test-note');
            smartGraphRegistry.registerEntity('ring', 'ITEM' as any, 'test-note');

            // Refresh WASM dictionary to ensure Aho-Corasick automaton includes them
            await this.goKitt.refreshDictionary();

            this.status = 'Ready. Entities Seeded (Gandalf, Frodo, Ring). Click Scan.';
        } catch (e) {
            console.error(e);
            this.status = 'Error seeding: ' + e;
        }
    }

    runScan() {
        this.status = 'Scanning...';
        this.scanResult = null;

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            try {
                const result = this.goKitt.scan(this.sampleText);
                console.log('Scan Result:', result);
                this.scanResult = result;

                const edgeCount = result.graph?.Edges?.length ?? 0;
                const nodeCount = result.graph?.Nodes ? Object.keys(result.graph.Nodes).length : 0;

                if (result.error) {
                    this.status = 'Error in Scan Result: ' + result.error;
                } else {
                    this.status = `Scan Complete. Nodes: ${nodeCount}, Edges: ${edgeCount}.`;
                }
            } catch (err) {
                console.error(err);
                this.status = 'Exception: ' + err;
            }
        }, 50);
    }

    getKeys(obj: any): string[] {
        return obj ? Object.keys(obj) : [];
    }
}
