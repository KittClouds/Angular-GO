// src/app/components/analytics-panel/flow-score/flow-score.component.ts
import { Component, input, computed, importProvidersFrom } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, TrendingUp, AlertCircle, Sparkles } from 'lucide-angular';
import { NgxNumberTickerComponent } from '@omnedia/ngx-number-ticker';

import type { SentenceLengthDistribution, FlowInsights } from '../../../lib/analytics';

interface CategoryConfig {
    key: keyof SentenceLengthDistribution;
    label: string;
    gradient: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
}

const CATEGORIES: CategoryConfig[] = [
    {
        key: '1',
        label: '1 word',
        gradient: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
        textColor: 'text-violet-200',
        bgColor: 'bg-violet-900/60',
        borderColor: 'border-violet-500/50'
    },
    {
        key: '2-6',
        label: '2-6 words',
        gradient: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
        textColor: 'text-blue-200',
        bgColor: 'bg-blue-900/60',
        borderColor: 'border-blue-500/50'
    },
    {
        key: '7-15',
        label: '7-15 words',
        gradient: 'linear-gradient(135deg, #34d399, #10b981)',
        textColor: 'text-emerald-200',
        bgColor: 'bg-emerald-900/60',
        borderColor: 'border-emerald-500/50'
    },
    {
        key: '16-25',
        label: '16-25 words',
        gradient: 'linear-gradient(135deg, #fb923c, #ea580c)',
        textColor: 'text-orange-200',
        bgColor: 'bg-orange-600/50',
        borderColor: 'border-orange-500/50'
    },
    {
        key: '26-39',
        label: '26-39 words',
        gradient: 'linear-gradient(135deg, #f87171, #dc2626)',
        textColor: 'text-red-200',
        bgColor: 'bg-red-600/50',
        borderColor: 'border-red-500/50'
    },
    {
        key: '40+',
        label: '40+ words',
        gradient: 'linear-gradient(135deg, #f87171, #ef4444)',
        textColor: 'text-rose-200',
        bgColor: 'bg-rose-900/60',
        borderColor: 'border-rose-500/50'
    },
];

@Component({
    selector: 'app-flow-score',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, NgxNumberTickerComponent],
    template: `
        <div class="space-y-4">
            <!-- Header with Score -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <lucide-icon [img]="TrendingUp" class="h-4 w-4 text-primary"></lucide-icon>
                    <span class="text-sm font-medium">Flow Score</span>
                </div>
                <div class="flex items-center gap-2">
                    <!-- Animated Score -->
                    <div class="flow-score-badge" [class]="scoreColorClass()">
                        <om-number-ticker
                            [countTo]="score()"
                            [countDuration]="500"
                            styleClass="text-xl font-bold"
                        ></om-number-ticker>
                        <span class="text-lg font-bold">%</span>
                    </div>
                    <span class="text-xs font-medium" [class]="gradeColorClass()">
                        {{ grade().label }}
                    </span>
                </div>
            </div>

            <!-- Animated Progress Bar -->
            <div class="flow-progress-container">
                <div 
                    class="flow-progress-bar"
                    [class]="progressGradientClass()"
                    [style.width.%]="score()"
                ></div>
            </div>

            <!-- Sentence Distribution Grid -->
            <div class="space-y-2">
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Sentence Variation
                </span>
                <div class="grid grid-cols-3 gap-2">
                    @for (cat of categories; track cat.key) {
                        <div 
                            class="distribution-card"
                            [class]="cat.bgColor + ' ' + cat.borderColor"
                            [class.dominant]="cat.key === insights()?.dominantRange"
                        >
                            @if (cat.key === insights()?.dominantRange) {
                                <lucide-icon [img]="Sparkles" class="dominant-sparkle"></lucide-icon>
                            }
                            
                            <div class="flex flex-col gap-0.5">
                                <span class="text-xs font-medium" [class]="cat.textColor">
                                    {{ cat.label }}
                                </span>
                                <div class="flex items-baseline gap-1.5">
                                    <om-number-ticker
                                        [countTo]="getCount(cat.key)"
                                        [countDuration]="400"
                                        [styleClass]="'text-2xl font-bold ' + cat.textColor"
                                    ></om-number-ticker>
                                    <span class="text-xs text-muted-foreground">
                                        {{ getPercentage(cat.key) }}%
                                    </span>
                                </div>
                            </div>

                            <!-- Mini progress bar -->
                            <div class="mini-progress-track">
                                <div 
                                    class="mini-progress-bar"
                                    [style.width.%]="getPercentage(cat.key)"
                                    [style.background]="cat.gradient"
                                ></div>
                            </div>
                        </div>
                    }
                </div>
            </div>

            <!-- Insights & Recommendations -->
            <div class="space-y-2">
                @if (insights()?.hasMonotony) {
                    <div class="insight-warning">
                        <lucide-icon [img]="AlertCircle" class="h-4 w-4 text-amber-400 shrink-0"></lucide-icon>
                        <div class="text-xs">
                            <p class="font-medium text-amber-100">Monotony detected</p>
                            <p class="text-amber-300/80 mt-0.5">
                                You have 5+ consecutive sentences of similar length. Try breaking them up for variety.
                            </p>
                        </div>
                    </div>
                }

                @if (insights()?.consecutivePatterns && insights()?.consecutivePatterns! > 0 && !insights()?.hasMonotony) {
                    <p class="text-xs text-muted-foreground italic">
                        Found {{ insights()?.consecutivePatterns }} pattern{{ insights()?.consecutivePatterns! > 1 ? 's' : '' }} 
                        of consecutive similar sentences. Consider mixing lengths for better rhythm.
                    </p>
                }

                @if (score() >= 85) {
                    <p class="text-xs text-emerald-400 italic font-medium">
                        ✨ Excellent sentence variety! Your writing has great rhythm and flow.
                    </p>
                }

                @if (score() < 50 && score() > 0 && !insights()?.hasMonotony) {
                    <p class="text-xs text-muted-foreground italic">
                        Mix short, medium, and long sentences to improve flow and engage readers.
                    </p>
                }
            </div>

            <!-- Variety Score Badge -->
            <div class="flex items-center justify-between pt-2 border-t border-border/30">
                <span class="text-xs text-muted-foreground">Distribution Balance</span>
                <span class="text-xs font-mono px-2 py-0.5 bg-muted/30 rounded">
                    {{ insights()?.varietyScore || 0 }}% varied
                </span>
            </div>
        </div>
    `,
    styles: [`
        .flow-score-badge {
            display: flex;
            align-items: baseline;
            gap: 1px;
            padding: 0.25rem 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid;
            background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
        }

        .flow-score-badge.excellent {
            border-color: rgba(16, 185, 129, 0.5);
            color: #34d399;
        }

        .flow-score-badge.good {
            border-color: rgba(59, 130, 246, 0.5);
            color: #60a5fa;
        }

        .flow-score-badge.fair {
            border-color: rgba(245, 158, 11, 0.5);
            color: #fbbf24;
        }

        .flow-score-badge.needs-work {
            border-color: rgba(239, 68, 68, 0.5);
            color: #f87171;
        }

        .flow-progress-container {
            height: 0.75rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 0.5rem;
            overflow: hidden;
        }

        .flow-progress-bar {
            height: 100%;
            border-radius: 0.5rem;
            transition: width 0.7s ease-out;
        }

        .flow-progress-bar.excellent {
            background: linear-gradient(90deg, #10b981, #3b82f6);
        }

        .flow-progress-bar.good {
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        }

        .flow-progress-bar.fair {
            background: linear-gradient(90deg, #f59e0b, #f97316);
        }

        .flow-progress-bar.needs-work {
            background: linear-gradient(90deg, #ef4444, #f43f5e);
        }

        .distribution-card {
            position: relative;
            padding: 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid;
            transition: all 0.3s ease;
        }

        .distribution-card:hover {
            transform: scale(1.02);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .distribution-card.dominant {
            ring: 2px;
            ring-offset: 2px;
            ring-color: hsl(var(--primary));
            box-shadow: 0 0 20px rgba(var(--primary), 0.2);
        }

        .dominant-sparkle {
            position: absolute;
            top: -0.375rem;
            right: -0.375rem;
            width: 1rem;
            height: 1rem;
            color: hsl(var(--primary));
            fill: hsl(var(--primary));
        }

        .mini-progress-track {
            margin-top: 0.5rem;
            height: 0.25rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            overflow: hidden;
        }

        .mini-progress-bar {
            height: 100%;
            border-radius: 0.25rem;
            transition: width 0.5s ease;
        }

        .insight-warning {
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
            padding: 0.75rem;
            border-radius: 0.5rem;
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
    `]
})
export class FlowScoreComponent {
    score = input<number>(0);
    distribution = input<SentenceLengthDistribution>();
    insights = input<FlowInsights>();

    readonly categories = CATEGORIES;

    // Icons
    readonly TrendingUp = TrendingUp;
    readonly AlertCircle = AlertCircle;
    readonly Sparkles = Sparkles;

    grade = computed(() => {
        const s = this.score();
        if (s >= 85) return { label: 'Excellent', key: 'excellent' };
        if (s >= 70) return { label: 'Good', key: 'good' };
        if (s >= 50) return { label: 'Fair', key: 'fair' };
        return { label: 'Needs Work', key: 'needs-work' };
    });

    scoreColorClass = computed(() => this.grade().key);
    gradeColorClass = computed(() => {
        const g = this.grade().key;
        if (g === 'excellent') return 'text-emerald-400';
        if (g === 'good') return 'text-blue-400';
        if (g === 'fair') return 'text-amber-400';
        return 'text-rose-400';
    });

    progressGradientClass = computed(() => this.grade().key);

    totalSentences = computed(() => {
        const d = this.distribution();
        if (!d) return 0;
        return Object.values(d).reduce((a, b) => a + b, 0);
    });

    getCount(key: keyof SentenceLengthDistribution): number {
        return this.distribution()?.[key] ?? 0;
    }

    getPercentage(key: keyof SentenceLengthDistribution): number {
        const total = this.totalSentences();
        if (total === 0) return 0;
        return Math.round((this.getCount(key) / total) * 100);
    }
}
