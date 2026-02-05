import { EnvironmentInjector, ApplicationRef, ComponentRef, createComponent } from '@angular/core';
import { Ctx } from '@milkdown/kit/ctx';
import { EditorView } from '@milkdown/kit/prose/view';
import { EditorState, PluginView, TextSelection } from '@milkdown/kit/prose/state';
import { tooltipFactory, TooltipProvider } from '@milkdown/kit/plugin/tooltip';
import { EditorToolbarComponent } from './toolbar.component';

export class AngularToolbarPluginView implements PluginView {
    private tooltipProvider: TooltipProvider;
    private content: HTMLElement;
    private componentRef: ComponentRef<EditorToolbarComponent>;

    constructor(
        private ctx: Ctx,
        private view: EditorView,
        private injector: EnvironmentInjector,
        private appRef: ApplicationRef,
        private getNoteId?: () => string | undefined
    ) {
        // Create container element
        this.content = document.createElement('div');
        this.content.className = 'angular-toolbar-wrapper';
        this.content.style.position = 'absolute';
        this.content.style.zIndex = '50';

        // Create Angular component
        this.componentRef = createComponent(EditorToolbarComponent, {
            environmentInjector: this.injector,
            hostElement: this.content
        });

        // Pass inputs
        this.componentRef.instance.ctx = this.ctx;

        // Listen for hide event
        this.componentRef.instance.hide.subscribe(() => {
            this.content.style.display = 'none';
        });

        // Attach to app for change detection
        this.appRef.attachView(this.componentRef.hostView);

        // Create tooltip provider for positioning
        this.tooltipProvider = new TooltipProvider({
            content: this.content,
            debounce: 50,
            offset: { mainAxis: 10 },
            shouldShow: (view: EditorView) => {
                const { doc, selection } = view.state;
                const { empty, from, to } = selection;

                // Don't show if selection is empty
                if (empty) {
                    this.content.style.display = 'none';
                    return false;
                }

                // Don't show if not a text selection
                if (!(selection instanceof TextSelection)) {
                    this.content.style.display = 'none';
                    return false;
                }

                // Don't show if no actual text selected
                const isEmptyTextBlock = !doc.textBetween(from, to).length;
                if (isEmptyTextBlock) {
                    this.content.style.display = 'none';
                    return false;
                }

                // Don't show if editor is readonly
                if (!view.editable) {
                    this.content.style.display = 'none';
                    return false;
                }

                // Don't show if tooltip children have focus (so we don't hide when clicking buttons)
                const activeElement = (view.dom.getRootNode() as ShadowRoot | Document).activeElement;
                const isTooltipChildren = this.content.contains(activeElement);

                const hasFocus = view.hasFocus() || isTooltipChildren;

                if (!hasFocus) {
                    this.content.style.display = 'none';
                    return false;
                }

                this.content.style.display = 'block';
                return true;
            },
        });

        this.update(view);
    }

    update = (view: EditorView, prevState?: EditorState) => {
        this.tooltipProvider.update(view, prevState);
        // Update Angular component state
        this.componentRef.instance.update(view.state);
        // Update noteId if getter provided
        if (this.getNoteId) {
            this.componentRef.instance.noteId = this.getNoteId();
        }
    };

    destroy = () => {
        this.tooltipProvider.destroy();
        this.appRef.detachView(this.componentRef.hostView);
        this.componentRef.destroy();
        this.content.remove();
    };
}

// Global reference for the dynamic view creation
export const angularSelectionTooltip = tooltipFactory('ANGULAR_SELECTION_TOOLBAR');

// Configuration factory
export function configureAngularToolbar(
    injector: EnvironmentInjector,
    appRef: ApplicationRef,
    getNoteId?: () => string | undefined
) {
    return (ctx: Ctx) => {
        ctx.set(angularSelectionTooltip.key, {
            view: (view: EditorView) => new AngularToolbarPluginView(ctx, view, injector, appRef, getNoteId),
        });

        // Return the plugin to be used
        // Note: In Milkdown config, we usually return a config function or array of plugins
        // But here we are configuring a specific key. 
        // We also need to ensure the plugin itself is used.
    };
}

export const angularToolbarPlugin = angularSelectionTooltip;

