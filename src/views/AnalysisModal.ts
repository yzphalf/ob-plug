import { App, Modal, Setting, Notice } from 'obsidian';
import { t } from '../lang/translator';

export class AnalysisModal extends Modal {
    private symbol: string = '';
    private note: string = '';
    private onSubmit: (symbol: string, note: string) => void;

    constructor(app: App, onSubmit: (symbol: string, note: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: t('Insert Market Analysis') });

        new Setting(contentEl)
            .setName(t('Symbol'))
            .setDesc(t('e.g. BTCUSDT'))
            .addText((text) =>
                text.onChange((value) => {
                    this.symbol = value;
                })
            );

        new Setting(contentEl)
            .setName(t('Note'))
            .setDesc(t('Your thoughts...'))
            .addTextArea((text) =>
                text
                    .setPlaceholder(t('Enter your analysis here...'))
                    .onChange((value) => {
                        this.note = value;
                    })
            );

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText(t('Submit'))
                .setCta()
                .onClick(() => {
                    if (!this.symbol || !this.note) {
                        new Notice(t('Please fill in all fields.'));
                        return;
                    }
                    this.close();
                    this.onSubmit(this.symbol.toUpperCase(), this.note);
                })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
