/**
 * 交易同步服务 (Trade Sync Service)
 *
 * 这个文件是本插件最核心的“调度员”。它协调了数据获取、数据处理、文件读写三个环节。
 * 当用户点击“同步数据”按钮时，就是在这里开始工作的。
 *
 * 主要流程 (`syncTrades`):
 * 1. 调用 `BinanceDataProvider` 从交易所拉取最新的成交记录和资金流水。
 * 2. 处理数据：将原始的成交记录（Fills）聚合为完整的“交易”（Trade，即一笔有开有平的操作）。
 * 3. 遍历交易：对每一笔交易：
 *    - 检查是否已有对应的 Obsidian 笔记。
 *    - 如果没有 -> 调用 `NoteGenerator` 创建新笔记。
 *    - 如果有 -> 调用 `ContentMerger` 更新笔记中的数据表格，同时保留用户心得。
 * 4. 性能优化：支持增量同步，只拉取上次同步之后的数据。
 */
import { Notice, TFile, App } from 'obsidian';
import { IDataAdapter } from '../models/adapter.interface';
import { MyPluginSettings } from '../infrastructure/obsidian/settings';
import { StandardizedTrade } from '../models/types';
import { generateObsidianNote } from '../core/NoteGenerator';
import { t } from '../lang/translator';
import { SymbolService } from './SymbolService';
import { mergeNoteContent } from '../core/ContentMerger';

declare const moment: any; // For date parsing

export class TradeSyncService {
    private dataProvider: IDataAdapter;
    private settings: MyPluginSettings;
    private app: App;
    private symbolService: SymbolService; // New property for SymbolService

    // A callback to notify the main plugin when settings need to be saved
    private saveSettingsCallback: () => Promise<void>;

    constructor(app: App, dataProvider: IDataAdapter, settings: MyPluginSettings, saveSettingsCallback: () => Promise<void>, symbolService: SymbolService) {
        this.app = app;
        this.dataProvider = dataProvider;
        this.settings = settings;
        this.saveSettingsCallback = saveSettingsCallback;
        this.symbolService = symbolService; // Assign SymbolService
    }

    public setDataProvider(dataProvider: IDataAdapter) {
        this.dataProvider = dataProvider;
    }

    private getLastSyncTimestamp(): number {
        if (this.settings.exchange === 'OKX') {
            return this.settings.lastSyncTimestampOkx;
        }
        return this.settings.lastSyncTimestampBinance;
    }

    private setLastSyncTimestamp(ts: number) {
        if (this.settings.exchange === 'OKX') {
            this.settings.lastSyncTimestampOkx = ts;
        } else {
            this.settings.lastSyncTimestampBinance = ts;
        }
        // Also update legacy for backward-compatibility if needed, or ignore it.
        this.settings.lastSyncTimestamp = ts;
    }

    public async syncTrades(isSilent: boolean = false): Promise<void> {
        if (!isSilent) {
            new Notice(t('Fetching exchange data...'));
        }
        try {
            const standardizedTrades = await this.dataProvider.getStandardizedTrades();
            await this.createArchiveNotes(standardizedTrades, isSilent);

            // After a successful sync, update the lastSyncTimestamp
            if (standardizedTrades.length > 0) {
                const maxTimestamp = standardizedTrades.reduce((max, trade) => {
                    const tradeMaxTs = trade._rawFills.reduce((fillMax, fill) => Math.max(fillMax, parseInt(fill.ts)), 0);
                    return Math.max(max, tradeMaxTs);
                }, 0);

                const currentLastSync = this.getLastSyncTimestamp();
                if (maxTimestamp > currentLastSync) {
                    this.setLastSyncTimestamp(maxTimestamp);
                    this.dataProvider.setLastSyncTimestamp(maxTimestamp); // Keep provider in sync
                    await this.saveSettingsCallback(); // Notify main plugin to save settings
                    console.log(`New lastSyncTimestamp for ${this.settings.exchange} set to: ${maxTimestamp}. Settings saved.`);
                }
            }

        } catch (error) {
            console.error(t('Error fetching or processing Exchange data:'), error);
            if (isSilent) return;

            if (error instanceof Error && error.message.toLowerCase().includes('fetch')) {
                new Notice(t('Network error. Check proxy URL, network connection, or API credentials.'), 10000);
            } else {
                new Notice(t('Failed to process data. Check console for details.'), 5000);
            }
        }
    }

    public async resetSyncState(): Promise<void> {
        this.setLastSyncTimestamp(0);
        this.dataProvider.setLastSyncTimestamp(0);
        await this.saveSettingsCallback();
        console.log(`Sync state for ${this.settings.exchange} reset to 0.`);
    }

    public async fetchTickerPrice(symbol: string): Promise<number> {
        return this.dataProvider.getTickerPrice(symbol);
    }

    private async createArchiveNotes(trades: StandardizedTrade[], isSilent: boolean = false): Promise<void> {
        const baseArchiveFolder = this.settings.archiveFolder;
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        for (const trade of trades) {
            this.symbolService.addSymbol(trade.symbol); // Use direct addSymbol method
            const weeklyPath = this.getWeeklyNotePath(trade.entryTime);
            const fullFolderPath = `${baseArchiveFolder}/${weeklyPath}`;

            await this.app.vault.createFolder(fullFolderPath).catch(err => {
                if (!err.message.includes('Folder already exists')) {
                    console.error(t('Error creating folder {{folderPath}}:').replace('{{folderPath}}', fullFolderPath), err);
                    return;
                }
            });

            const noteContent = generateObsidianNote(trade);
            const entryDate = moment(trade.entryTime).format('YYYY-MM-DD HH-mm-ss');
            const fileName = `${entryDate} - ${trade.id}.md`;
            const fullFilePath = `${fullFolderPath}/${fileName}`;

            const file = this.app.vault.getAbstractFileByPath(fullFilePath);

            if (file instanceof TFile) {
                const oldContent = await this.app.vault.cachedRead(file);
                // Merge old user content into new content
                const mergedContent = mergeNoteContent(oldContent, noteContent);

                if (oldContent !== mergedContent) {
                    await this.app.vault.modify(file, mergedContent);
                    updatedCount++;
                } else {
                    skippedCount++;
                }
            } else {
                const newFile = await this.app.vault.create(fullFilePath, noteContent);
                this.symbolService.addSymbolToCache(newFile); // Use SymbolService to add symbol to cache
                createdCount++;
            }
        }

        if (!isSilent) {
            if (createdCount > 0 || updatedCount > 0) {
                new Notice(t('Sync complete: {{created}} created, {{updated}} updated.').replace('{{created}}', createdCount.toString()).replace('{{updated}}', updatedCount.toString()));
            } else {
                new Notice(t('Sync complete: All {{skipped}} notes are up-to-date.').replace('{{skipped}}', skippedCount.toString()));
            }
        }
    }

    private getWeeklyNotePath(tradeTimestamp: number): string {
        const tradeDate = moment(tradeTimestamp);
        const year = tradeDate.format('YYYY');
        const weekNumber = tradeDate.format('W');
        const startOfWeek = tradeDate.clone().startOf('isoWeek');
        const endOfWeek = tradeDate.clone().endOf('isoWeek');
        const startStr = startOfWeek.format('M.D');
        const endStr = endOfWeek.format('M.D');
        const folderName = `${weekNumber}周 (${startStr}-${endStr})`;
        return `${year}/${folderName}`;
    }
}
