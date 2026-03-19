import { Component, Input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PatternToken, compileTokensToRegex } from '../types';

interface MatchSegment {
    text: string;
    isMatch: boolean;
    groups?: Record<string, string>;
}

@Component({
    selector: 'app-live-match-highlighter',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div *ngIf="input && tokens.length" class="mt-3 p-3 bg-card border border-border rounded-lg max-h-[400px] overflow-y-auto">
        <div class="text-xs text-muted-foreground mb-2">
            <span *ngIf="matches().length">{{ matches().length }} match(es) found</span>
            <span *ngIf="!matches().length">No matches</span>
        </div>
        <div class="font-mono text-sm leading-relaxed whitespace-pre-wrap">
            <ng-container *ngFor="let seg of segments()">
                <span *ngIf="!seg.isMatch">{{ seg.text }}</span>
                <span *ngIf="seg.isMatch" 
                    class="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1 rounded border border-emerald-500/30">
                    {{ seg.text }}
                </span>
            </ng-container>
        </div>
    </div>
  `,
    styles: [`:host { display: block; }`]
})
export class LiveMatchHighlighterComponent {
    @Input() tokens: PatternToken[] = [];
    @Input() input = '';

    matches = computed(() => {
        if (!this.input || !this.tokens.length) return [];

        try {
            const pattern = compileTokensToRegex(this.tokens);
            const regex = new RegExp(pattern, 'g');
            const results: RegExpExecArray[] = [];
            let match;

            while ((match = regex.exec(this.input)) !== null) {
                results.push(match);
                if (match.index === regex.lastIndex) regex.lastIndex++;
            }

            return results;
        } catch {
            return [];
        }
    });

    segments = computed((): MatchSegment[] => {
        const matchList = this.matches();
        if (!matchList.length) {
            return [{ text: this.input, isMatch: false }];
        }

        const segs: MatchSegment[] = [];
        let lastIndex = 0;

        for (const match of matchList) {
            if (match.index > lastIndex) {
                segs.push({ text: this.input.slice(lastIndex, match.index), isMatch: false });
            }
            segs.push({ text: match[0], isMatch: true });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < this.input.length) {
            segs.push({ text: this.input.slice(lastIndex), isMatch: false });
        }

        return segs;
    });
}
