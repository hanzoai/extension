import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import complete from '@salesforce/apex/HanzoController.complete';
import listModels from '@salesforce/apex/HanzoController.listModels';
import writeBack from '@salesforce/apex/HanzoController.writeBack';

/**
 * hanzoAssistant — the AI panel that drops onto Account / Opportunity / Case /
 * Lead / Contact record pages. Same UX language as the office task pane and the
 * Slack app: a model picker, quick-action buttons, an output area, and a prompt.
 *
 * Every action funnels through one path: run(task) → HanzoController.complete →
 * render. No streaming (one Apex callout → render), matching every non-Node Hanzo
 * integration. The record's context is assembled server-side (HanzoContext) so no
 * record data crosses the client boundary beyond the recordId.
 */

// Quick actions, each a fixed instruction. `id` labels the button; `task` is the
// prompt sent to the model. One list, rendered once — add an action here only.
const QUICK_ACTIONS = [
    { id: 'summarize', label: 'Summarize', task: 'Summarize this record for a sales rep in 3-5 bullet points.' },
    { id: 'email', label: 'Draft email', task: 'Draft a concise, friendly follow-up email to the primary contact based on this record. Return only the email body.' },
    { id: 'nextSteps', label: 'Next steps', task: 'Extract the concrete next steps for this record as a short numbered list.' },
    { id: 'risks', label: 'Risks', task: 'Identify risks or blockers for this record and how to address each.' }
];

// Write-back targets shown after output is produced. kind maps to
// HanzoController.writeBack; label is the button text and toast noun.
const WRITE_TARGETS = [
    { kind: 'TASK', label: 'Save as Task' },
    { kind: 'NOTE', label: 'Save as Note' },
    { kind: 'CHATTER', label: 'Post to Chatter' }
];

const DEFAULT_MODEL = 'zen5';

export default class HanzoAssistant extends LightningElement {
    @api recordId;

    @track models = [];
    @track output = '';
    selectedModel = DEFAULT_MODEL;
    prompt = '';
    loading = false;
    saving = false;
    errorMessage = '';

    quickActions = QUICK_ACTIONS;
    writeTargets = WRITE_TARGETS;

    // Load the model picker once. Non-fatal: an empty list leaves the default.
    async connectedCallback() {
        try {
            const models = await listModels();
            if (models && models.length) {
                this.models = models.map((m) => ({ label: m.id, value: m.id }));
                if (!this.models.some((m) => m.value === this.selectedModel)) {
                    this.selectedModel = this.models[0].value;
                }
            }
        } catch (e) {
            // Picker is best-effort; the default model still routes.
            this.models = [];
        }
    }

    get modelOptions() {
        if (this.models.length) {
            return this.models;
        }
        return [{ label: DEFAULT_MODEL, value: DEFAULT_MODEL }];
    }

    get hasOutput() {
        return this.output.length > 0;
    }

    get busy() {
        return this.loading || this.saving;
    }

    get runDisabled() {
        return this.busy || this.prompt.trim().length === 0;
    }

    handleModelChange(event) {
        this.selectedModel = event.detail.value;
    }

    handlePromptChange(event) {
        this.prompt = event.target.value;
    }

    // Quick-action click: the button's data-task carries the instruction.
    handleQuickAction(event) {
        const task = event.currentTarget.dataset.task;
        this.run(task);
    }

    // Ask from the free-text prompt.
    handleAsk() {
        const task = this.prompt.trim();
        if (task) {
            this.run(task);
        }
    }

    // The one code path every action uses: run a completion, render or surface.
    async run(task) {
        this.loading = true;
        this.errorMessage = '';
        try {
            this.output = await complete({
                task,
                recordId: this.recordId,
                model: this.selectedModel
            });
        } catch (e) {
            this.errorMessage = this.messageFor(e);
            this.toast('Hanzo AI', this.errorMessage, 'error');
        } finally {
            this.loading = false;
        }
    }

    // Write-back click: the button's data-kind picks the target.
    async handleWriteBack(event) {
        const kind = event.currentTarget.dataset.kind;
        this.saving = true;
        try {
            await writeBack({ recordId: this.recordId, text: this.output, kind });
            const noun = WRITE_TARGETS.find((t) => t.kind === kind);
            this.toast('Saved', `${noun ? noun.label : kind} created on this record.`, 'success');
        } catch (e) {
            this.toast('Hanzo AI', this.messageFor(e), 'error');
        } finally {
            this.saving = false;
        }
    }

    // AuraHandledException surfaces its message under body.message.
    messageFor(error) {
        return (
            (error && error.body && error.body.message) ||
            (error && error.message) ||
            'Something went wrong talking to Hanzo AI.'
        );
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
