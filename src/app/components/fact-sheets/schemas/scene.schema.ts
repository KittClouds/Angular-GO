import { EntityFactSheetSchema, CARD_GRADIENTS } from '../types';

export const sceneSchema: EntityFactSheetSchema = {
    entityKind: 'SCENE',
    cards: [
        {
            id: 'overview',
            title: 'Scene Overview',
            icon: 'clapperboard',
            gradient: CARD_GRADIENTS.identity,
            fields: [
                {
                    name: 'status',
                    label: 'Status',
                    type: 'dropdown',
                    options: ['Idea', 'Outline', 'Draft', 'Revised', 'Final', 'Cut'],
                    defaultValue: 'Idea'
                },
                {
                    name: 'synopsis',
                    label: 'Synopsis',
                    type: 'text',
                    multiline: true,
                    placeholder: 'What happens in this scene?'
                },
                {
                    name: 'pov',
                    label: 'POV Character',
                    type: 'array',
                    addButtonText: 'Add POV'
                }
            ]
        },
        {
            id: 'timeline',
            title: 'Timeline & Setting',
            icon: 'clock',
            gradient: CARD_GRADIENTS.progression,
            fields: [
                {
                    name: 'time',
                    label: 'Time / Date',
                    type: 'text',
                    placeholder: 'e.g., Late Afternoon, 3rd of Mirtul'
                },
                {
                    name: 'duration',
                    label: 'Duration',
                    type: 'text',
                    placeholder: 'e.g., 2 hours'
                },
                {
                    name: 'location',
                    label: 'Location',
                    type: 'text',
                    placeholder: 'Where does this take place?'
                }
            ]
        },
        {
            id: 'notes',
            title: 'Scene Notes',
            icon: 'file-text',
            gradient: CARD_GRADIENTS.notes,
            fields: [
                {
                    name: 'tone',
                    label: 'Tone / Mood',
                    type: 'text',
                    placeholder: 'e.g., Tense, Humorous'
                },
                {
                    name: 'privateNotes',
                    label: 'Private Notes',
                    type: 'text',
                    multiline: true,
                    placeholder: 'Internal thoughts, foreshadowing...'
                }
            ]
        }
    ]
};
