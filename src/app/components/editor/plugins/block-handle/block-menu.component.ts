import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    LucideAngularModule,
    Pilcrow, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
    Quote, Minus, List, ListOrdered, CheckSquare, Image, Code, ChevronDown,
    Table, Calculator, Copy, Clipboard, AlignLeft, AlignCenter, AlignRight
} from 'lucide-angular';
import { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import {
    setBlockTypeCommand, wrapInBlockTypeCommand, addBlockTypeCommand,
    clearTextInCurrentBlockCommand, paragraphSchema, headingSchema,
    blockquoteSchema, hrSchema, bulletListSchema, orderedListSchema,
    codeBlockSchema
} from '@milkdown/kit/preset/commonmark';


import { NodeSelection } from '@milkdown/kit/prose/state';
import { setTextAlignCommand } from '../nodes';

type Tab = 'text' | 'list' | 'advanced' | 'actions';

@Component({
    selector: 'app-block-menu',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="flex flex-col w-64 bg-popover border border-border rounded-lg shadow-xl overflow-hidden text-sm text-popover-foreground">
            <div class="flex border-b border-border bg-muted/50">
                <button
                    *ngFor="let tab of tabs"
                    class="flex-1 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    [class.text-primary]="activeTab() === tab.id"
                    [class.border-b-2]="activeTab() === tab.id"
                    [class.border-primary]="activeTab() === tab.id"
                    [class.text-muted-foreground]="activeTab() !== tab.id"
                    (click)="activeTab.set(tab.id)"
                >
                    {{ tab.label }}
                </button>
            </div>

            <div class="p-1 min-h-[160px] max-h-[300px] overflow-y-auto custom-scrollbar">
                
                <!-- TEXT TAB -->
                <ng-container *ngIf="activeTab() === 'text'">
                    <div class="px-2 py-1 text-xs text-muted-foreground font-bold uppercase tracking-wider">Turn Into</div>
                    <button class="menu-item" (click)="run(insertParagraph)">
                        <lucide-icon [img]="Pilcrow" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Paragraph
                    </button>
                    <button class="menu-item" (click)="run(insertHeading(1))">
                        <lucide-icon [img]="Heading1" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Heading 1
                    </button>
                    <button class="menu-item" (click)="run(insertHeading(2))">
                        <lucide-icon [img]="Heading2" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Heading 2
                    </button>
                    <button class="menu-item" (click)="run(insertHeading(3))">
                        <lucide-icon [img]="Heading3" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Heading 3
                    </button>
                    <button class="menu-item" (click)="run(insertQuote)">
                        <lucide-icon [img]="Quote" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Quote
                    </button>
                     <button class="menu-item" (click)="run(insertDivider)">
                        <lucide-icon [img]="Minus" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Divider
                    </button>
                </ng-container>

                <!-- LIST TAB -->
                 <ng-container *ngIf="activeTab() === 'list'">
                    <button class="menu-item" (click)="run(insertBulletList)">
                        <lucide-icon [img]="List" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Bullet List
                    </button>
                    <button class="menu-item" (click)="run(insertOrderedList)">
                        <lucide-icon [img]="ListOrdered" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Ordered List
                    </button>
                    <button class="menu-item" (click)="run(insertTaskList)">
                        <lucide-icon [img]="CheckSquare" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Task List
                    </button>
                </ng-container>

                <!-- ADVANCED TAB -->
                <ng-container *ngIf="activeTab() === 'advanced'">
                     <button class="menu-item" (click)="run(insertCodeBlock)">
                        <lucide-icon [img]="Code" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Code Block
                    </button>
                    <!-- Stubs -->
                    <button class="menu-item" (click)="stub('Image')">
                        <lucide-icon [img]="Image" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Image
                    </button>
                     <button class="menu-item" (click)="stub('Collapsible')">
                        <lucide-icon [img]="ChevronDown" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Collapsible Section
                    </button>
                    <button class="menu-item" (click)="stub('Table')">
                        <lucide-icon [img]="Table" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Table
                    </button>
                     <button class="menu-item" (click)="stub('Math')">
                        <lucide-icon [img]="Calculator" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Math
                    </button>
                </ng-container>

                 <!-- ACTIONS TAB -->
                <ng-container *ngIf="activeTab() === 'actions'">

                    <button class="menu-item" (click)="run(duplicateBlock)">
                        <lucide-icon [img]="Copy" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Duplicate
                    </button>
                     <button class="menu-item" (click)="run(copyToClipboard)">
                        <lucide-icon [img]="Clipboard" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Copy to Clipboard
                    </button>
                    <div class="h-px bg-border my-1 mx-2"></div>
                    <div class="px-2 py-1 text-xs text-muted-foreground font-bold uppercase tracking-wider">Align</div>
                     <button class="menu-item" (click)="run(align('left'))">
                        <lucide-icon [img]="AlignLeft" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Left
                    </button>
                    <button class="menu-item" (click)="run(align('center'))">
                        <lucide-icon [img]="AlignCenter" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Center
                    </button>
                    <button class="menu-item" (click)="run(align('right'))">
                        <lucide-icon [img]="AlignRight" class="w-4 h-4 mr-2 text-muted-foreground"></lucide-icon>
                        Right
                    </button>
                </ng-container>

            </div>
        </div>
    `,
    styles: [`
        .menu-item {
            @apply flex items-center w-full px-2 py-1.5 text-foreground rounded hover:bg-muted transition-colors text-left;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            @apply bg-border rounded;
        }
    `]
})
export class BlockMenuComponent {
    @Input() ctx!: Ctx;
    @Input() activeBlock: any;
    @Output() close = new EventEmitter<void>();

    activeTab = signal<Tab>('text');

    tabs: { id: Tab; label: string }[] = [
        { id: 'text', label: 'Text' },
        { id: 'list', label: 'List' },
        { id: 'advanced', label: 'Advanced' },
        { id: 'actions', label: 'Actions' }
    ];

    // Icons
    readonly Pilcrow = Pilcrow;
    readonly Heading1 = Heading1;
    readonly Heading2 = Heading2;
    readonly Heading3 = Heading3;
    readonly Heading4 = Heading4;
    readonly Heading5 = Heading5;
    readonly Heading6 = Heading6;
    readonly Quote = Quote;
    readonly Minus = Minus;
    readonly List = List;
    readonly ListOrdered = ListOrdered;
    readonly CheckSquare = CheckSquare;
    readonly Image = Image;
    readonly Code = Code;
    readonly ChevronDown = ChevronDown;
    readonly Table = Table;
    readonly Calculator = Calculator;
    readonly Copy = Copy;
    readonly Clipboard = Clipboard;
    readonly AlignLeft = AlignLeft;
    readonly AlignCenter = AlignCenter;
    readonly AlignRight = AlignRight;

    run(action: (ctx: Ctx) => void) {
        if (!this.ctx) return;
        try {
            action(this.ctx);
            this.close.emit();
        } catch (e) {
            console.error('Block Command Error', e);
        }
    }

    stub(name: string) {
        console.log(`Command [${name}] not implemented yet`);
        this.close.emit();
    }

    // --- Commands Generators ---

    insertParagraph = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
    }

    insertHeading = (level: number) => (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level } });
    }

    insertQuote = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) });
    }

    insertDivider = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) });
    }

    insertBulletList = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) });
    }

    insertOrderedList = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) });
    }

    insertTaskList = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        // 1. Turn into Bullet List first
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) });

        // 2. Set checked=false on the list item to make it a task
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;
        const { selection } = state;
        const { $from } = selection;

        // Find the list_item ancestor
        let depth = $from.depth;
        let node = $from.node(depth);
        while (depth > 0 && node && node.type.name !== 'list_item') {
            depth--;
            node = $from.node(depth);
        }

        if (node && node.type.name === 'list_item') {
            const pos = $from.before(depth);
            // checked: false makes it a task list item (unchecked)
            // checked: null is a regular list item
            const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
            dispatch(tr);
        }
    }

    insertCodeBlock = (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) });
    }

    align = (alignment: 'left' | 'center' | 'right') => (ctx: Ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(setTextAlignCommand.key, alignment);
    }



    duplicateBlock = (ctx: Ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        let node;
        let pos;

        if (this.activeBlock instanceof HTMLElement) {
            const domPos = view.posAtDOM(this.activeBlock, 0);
            // Ensure resolving a safe position in the document
            const safePos = Math.min(Math.max(0, domPos), state.doc.content.size);
            const $pos = state.doc.resolve(safePos);

            // Ensure we don't try to duplicate the doc itself
            if ($pos.depth > 0) {
                node = $pos.node();
                pos = $pos.after();
            }
        } else {
            const { $from } = state.selection;
            // Ensure we don't try to duplicate the doc itself
            if ($from.depth > 0) {
                node = $from.node();
                pos = $from.after();
            }
        }

        if (node && typeof pos === 'number') {
            const tr = state.tr.insert(pos, node.type.create(node.attrs, node.content));
            dispatch(tr);
        }
    }

    copyToClipboard = (ctx: Ctx) => {
        const serializer = ctx.get(serializerCtx);
        const view = ctx.get(editorViewCtx);
        const { $from } = view.state.selection;
        const node = $from.node();
        const markdown = serializer(node);
        navigator.clipboard.writeText(markdown).catch(console.error);
    }
}
