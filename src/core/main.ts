/**
 * 核心入口文件 (Main Plugin Entry)
 * 1. 初始化插件生命周期(`onload`, `onunload`)。
 * 2. 加载和保存用户设置。
 * 3. 初始化核心服务(TradeSyncService, ChartingService, SymbolService)。
 * 4. 注册 Obsidian 的界面组件（设置页、侧边栏视图、命令）。
 * 5. 设置自动化任务（如定时同步）。
 *
 * 简单来说，这个文件是整个插件的“大脑”，负责指挥各个模块协同工作。
 */
import { App, Plugin, requestUrl, Notice, TFile } from 'obsidian';
import { KLineView, K_LINE_VIEW_TYPE } from '../views/KLineView';
import { addIcon } from 'obsidian';
import { generateObsidianNote, generateAnalysisNote } from '../core/NoteGenerator';
import { AnalysisModal } from '../views/AnalysisModal';
import { StandardizedTrade, TimelineEvent, RawFill } from '../models/types';
import { MyPluginSettings, DEFAULT_SETTINGS, BinanceSettingTab } from '../infrastructure/obsidian/settings';
import { IDataAdapter } from '../models/adapter.interface';
import { ServiceContainer } from './ServiceContainer'; // New import
import { TradeSyncService } from '../services/TradeSyncService';
import { SymbolService } from '../services/SymbolService';
import { ChartingService } from '../services/ChartingService';
import { KLineDataService } from '../services/KLineDataService';
import { IndicatorService } from '../services/IndicatorService';
import { AnalysisService } from '../services/AnalysisService';
import { setLanguage, t } from '../lang/translator';

declare const moment: any;

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    public serviceContainer: ServiceContainer;

    public symbolService: SymbolService;
    public chartingService: ChartingService;
    public kLineDataService: KLineDataService;
    public tradeSyncService: TradeSyncService;
    public analysisService: AnalysisService;
    public indicatorService: IndicatorService;

    async onload() {
        // Register TradingView Icon
        addIcon('tradingview-icon', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="100%" height="100%"><path fill="currentColor" d="M14 2C7.37 2 2 7.37 2 14s5.37 12 12 12 12-5.37 12-12S20.63 2 14 2zm0 2c3.72 0 6.94 2.17 8.66 5.39-1.42 1.22-3.23 1.95-5.22 1.95-3.32 0-6.17-2.03-7.44-4.89C8.38 5.43 11 4 14 4zm-9.33 6.67C6.42 13.56 9.02 15.34 12 15.34c.91 0 1.78-.17 2.59-.47-.41 1.74-1.97 3.03-3.84 3.03-2.18 0-3.95-1.74-3.98-3.91l-.1-3.32zM14 24c-3.21 0-6.04-1.5-7.85-3.83 1.95-1.8 4.56-2.53 7.15-2.02.58.11 1.15.22 1.7.22 2.76 0 5-2.24 5-5 0-.58-.1-1.13-.26-1.65 2.12 1.48 3.51 3.91 3.51 6.65 0 3.09-2.51 5.6-5.6 5.6-1.15 0-2.23-.35-3.15-.96l-.5.39z"/></svg>');

        await this.loadSettings();
        setLanguage(this.settings.language);
        this.addSettingTab(new BinanceSettingTab(this.app, this));

        // Initialize Service Container
        this.serviceContainer = new ServiceContainer(
            this.app,
            this,
            this.settings,
            this.saveSettings.bind(this)
        );

        // Expose services for backward compatibility and view access
        this.symbolService = this.serviceContainer.symbolService;
        this.tradeSyncService = this.serviceContainer.tradeSyncService;
        this.analysisService = this.serviceContainer.analysisService;
        this.kLineDataService = this.serviceContainer.kLineDataService;
        this.chartingService = this.serviceContainer.chartingService;
        this.indicatorService = this.serviceContainer.indicatorService;

        // Initialize Status Bar
        const statusBarItem = this.addStatusBarItem();
        this.kLineDataService.setStatusBarItem(statusBarItem);

        // Register Views
        this.registerView(K_LINE_VIEW_TYPE, (leaf) => new KLineView(leaf, this));

        // Register Commands
        this.addCommand({
            id: 'fetch-and-process-data',
            name: t('Fetch & Process Data'),
            callback: () => this.tradeSyncService.syncTrades(false),
        });

        this.addCommand({
            id: 'insert-market-analysis',
            name: t('Insert Market Analysis'),
            callback: () => {
                new AnalysisModal(this.app, async (symbol, note) => {
                    new Notice(t('Fetching price for ') + symbol + '...');
                    try {
                        const price = await this.tradeSyncService.fetchTickerPrice(symbol);
                        const noteContent = generateAnalysisNote(symbol, price, note);

                        const fileName = `${moment().format('YYYY-MM-DD-HH-mm')} - ${symbol} Analysis.md`;
                        const folderPath = this.settings.analysisFolder || '@Analysis';

                        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                            await this.app.vault.createFolder(folderPath);
                        }

                        const filePath = `${folderPath}/${fileName}`;
                        const file = await this.app.vault.create(filePath, noteContent);

                        this.app.workspace.getLeaf(false).openFile(file);
                        new Notice(t('Analysis note created!'));

                    } catch (error) {
                        console.error(error);
                        new Notice(t('Failed to fetch price or create note: ') + error.message);
                    }
                }).open();
            },
        });

        this.addCommand({
            id: 'rebuild-symbol-cache',
            name: t('Rebuild Symbol Cache'),
            callback: () => {
                this.symbolService.buildSymbolCache();
                new Notice(t('Symbol cache rebuilt.'));
            },
        });

        // Register Events
        this.app.workspace.onLayoutReady(async () => {
            this.symbolService.buildSymbolCache();
            await this.chartingService.ensureKlineView();
            this.chartingService.handleActiveLeafChange();

            if (this.settings.enableKLineBackfill) {
                this.kLineDataService.startBackfillLoop();
            }
        });

        this.registerEvent(this.app.metadataCache.on('changed', (file) => this.symbolService.addSymbolToCache(file)));
        this.registerEvent(this.app.vault.on('rename', (file) => this.symbolService.addSymbolToCache(file as TFile)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.symbolService.removeSymbolFromCache(file as TFile)));
        this.registerEvent(this.app.workspace.on('active-leaf-change', this.chartingService.handleActiveLeafChange.bind(this.chartingService)));

        // Auto Sync
        if (this.settings.autoUpdateIntervalMinutes > 0) {
            this.registerInterval(
                window.setInterval(() => this.tradeSyncService.syncTrades(true), this.settings.autoUpdateIntervalMinutes * 60 * 1000)
            );
        }
    }

    onunload() {
        this.kLineDataService?.stopBackfillLoop();
    }

    async updateDataProvider() {
        // Delegate to container
        this.serviceContainer.updateDataProvider();

        // Settings are reference passed, so container sees updates.
        // But we might need to refresh references if container recreated them? No, container updates the service.
        new Notice(`Switched data provider to: ${this.settings.exchange}`);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (this.settings.lastSyncTimestamp > 0 && this.settings.lastSyncTimestampBinance === 0) {
            this.settings.lastSyncTimestampBinance = this.settings.lastSyncTimestamp;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
