/**
 * 插件设置管理 (Plugin Settings)
 *
 * 这个文件负责定义和渲染插件的设置界面。
 *
 * 主要功能：
 * 1. 类型定义：定义了 `MyPluginSettings` 数据结构，决定了我们在 `data.json` 里存什么。
 * 2. 默认值：提供了 `DEFAULT_SETTINGS`。
 * 3. 设置面板 (`BinanceSettingTab`)：使用 Obsidian 的 API 构建 UI，包含：
 *    - API 代理地址输入框。
 *    - 自动同步时间间隔设置。
 *    - 均线指标管理（MA/EMA 的增加、删除、颜色配置）。
 *    - 语言切换。
 */
import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import MyPlugin from '../../core/main'; // Import the main plugin class
import { setLanguage, t } from '../../lang/translator';

export interface CustomIndicatorSetting {
    id: string; // Unique ID for each custom indicator
    type: 'MA' | 'EMA';
    period: number;
    color: string;
    title: string;
    enabled: boolean;
}

export interface MyPluginSettings {
    binanceProxyUrl: string;
    instrumentType: string;
    requestLimit: number;
    archiveFolder: string;
    analysisFolder: string;
    enableKLineBackfill: boolean; // New setting for background caching
    autoUpdateIntervalMinutes: number; // New setting for auto-update
    syncStartDate: string; // New setting for start date of sync
    lastSyncTimestamp: number; // Deprecated: Legacy single timestamp
    lastSyncTimestampBinance: number; // New: Binance specific sync state
    lastSyncTimestampOkx: number; // New: OKX specific sync state
    language: string;
    exchange: 'BINANCE' | 'OKX'; // New setting
    customIndicators: CustomIndicatorSetting[];
    okxProxyUrl: string; // New setting for OKX proxy
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
    binanceProxyUrl: 'https://your-proxy.vercel.app/api/binance', // Default proxy
    okxProxyUrl: 'https://your-proxy.vercel.app/api/okx', // Default OKX proxy
    instrumentType: 'FUTURES',
    requestLimit: 100,
    archiveFolder: 'trades',
    analysisFolder: '@Analysis', // Default analysis folder
    enableKLineBackfill: true, // Default to true
    autoUpdateIntervalMinutes: 0, // Default to 0 (disabled)
    syncStartDate: '', // Default to empty string (no specific start date)
    lastSyncTimestamp: 0, // Default to 0 (never synced)
    lastSyncTimestampBinance: 0,
    lastSyncTimestampOkx: 0,
    language: 'en',
    exchange: 'BINANCE',
    customIndicators: [
        { id: 'ma21', type: 'MA', period: 21, color: '#F44336', title: 'MA 21', enabled: true },
        { id: 'ma50', type: 'MA', period: 50, color: '#FF9800', title: 'MA 50', enabled: true },
        { id: 'ma100', type: 'MA', period: 100, color: '#FFEB3B', title: 'MA 100', enabled: true },
        { id: 'ma200', type: 'MA', period: 200, color: '#4CAF50', title: 'MA 200', enabled: true },
        { id: 'ema21', type: 'EMA', period: 21, color: '#2196F3', title: 'EMA 21', enabled: true },
        { id: 'ema50', type: 'EMA', period: 50, color: '#3F51B5', title: 'EMA 50', enabled: true },
        { id: 'ema100', type: 'EMA', period: 100, color: '#9C27B0', title: 'EMA 100', enabled: true },
        { id: 'ema200', type: 'EMA', period: 200, color: '#E91E63', title: 'EMA 200', enabled: true },
    ],
};

export class BinanceSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: t('Binance Plugin Settings') });

        new Setting(containerEl)
            .setName(t('Language'))
            .setDesc(t('Select the interface language.'))
            .addDropdown(dropdown => dropdown
                .addOption('en', 'English')
                .addOption('zh', '中文')
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value;
                    await this.plugin.saveSettings();
                    setLanguage(value);
                    this.display(); // Re-render the settings tab
                }));

        new Setting(containerEl)
            .setName(t('Binance Proxy URL'))
            .setDesc(t('The URL of your Binance API proxy.'))
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.binanceProxyUrl)
                .setValue(this.plugin.settings.binanceProxyUrl)
                .onChange(async (value) => {
                    this.plugin.settings.binanceProxyUrl = value || DEFAULT_SETTINGS.binanceProxyUrl;
                    await this.plugin.saveSettings();
                    await this.plugin.updateDataProvider();
                }));

        new Setting(containerEl)
            .setName(t('Exchange'))
            .setDesc(t('Select the exchange to sync with.'))
            .addDropdown(dropdown => dropdown
                .addOption('BINANCE', 'Binance')
                .addOption('OKX', 'OKX')
                .setValue(this.plugin.settings.exchange)
                .onChange(async (value: 'BINANCE' | 'OKX') => {
                    this.plugin.settings.exchange = value;
                    await this.plugin.saveSettings();
                    await this.plugin.updateDataProvider(); // Update provider immediately
                    this.display(); // Re-render to show/hide relevant fields
                }));

        if (this.plugin.settings.exchange === 'OKX') {
            new Setting(containerEl)
                .setName('OKX Configuration')
                .setDesc(t('Note: OKX credentials (API Key, Secret, Passphrase) must be configured in your Vercel Proxy environment variables.'))
                .setHeading();

            new Setting(containerEl)
                .setName(t('OKX Proxy URL'))
                .setDesc(t('The URL of your OKX API proxy (e.g. https://your-proxy/api/okx).'))
                .addText(text => text
                    .setPlaceholder(DEFAULT_SETTINGS.okxProxyUrl)
                    .setValue(this.plugin.settings.okxProxyUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.okxProxyUrl = value || DEFAULT_SETTINGS.okxProxyUrl;
                        await this.plugin.saveSettings();
                        await this.plugin.updateDataProvider();
                    }));
        }

        new Setting(containerEl)
            .setName(t('Instrument Type'))
            .setDesc(t('The type of instrument to fetch data for (e.g., FUTURES, SPOT).'))
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.instrumentType)
                .setValue(this.plugin.settings.instrumentType)
                .onChange(async (value) => {
                    this.plugin.settings.instrumentType = value || DEFAULT_SETTINGS.instrumentType;
                    await this.plugin.saveSettings();
                    await this.plugin.updateDataProvider();
                }));

        new Setting(containerEl)
            .setName(t('Request Limit'))
            .setDesc(t('The maximum number of records to fetch per request.'))
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.requestLimit))
                .setValue(String(this.plugin.settings.requestLimit))
                .onChange(async (value) => {
                    const limit = parseInt(value, 10);
                    this.plugin.settings.requestLimit = isNaN(limit) ? DEFAULT_SETTINGS.requestLimit : limit;
                    await this.plugin.saveSettings();
                    await this.plugin.updateDataProvider();
                }));

        new Setting(containerEl)
            .setName(t('Sync Start Date'))
            .setDesc(t('Optional: Only sync trades from this date onwards (YYYY-MM-DD). Leave empty to sync all history.'))
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.syncStartDate)
                .onChange(async (value) => {
                    this.plugin.settings.syncStartDate = value.trim();
                    await this.plugin.saveSettings();
                    await this.plugin.updateDataProvider();
                }));

        new Setting(containerEl)
            .setName(t('Trades Folder'))
            .setDesc(t('The base folder where trade notes will be saved.'))
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.archiveFolder)
                .setValue(this.plugin.settings.archiveFolder)
                .onChange(async (value) => {
                    this.plugin.settings.archiveFolder = value || DEFAULT_SETTINGS.archiveFolder;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('Analysis Folder'))
            .setDesc(t('The folder where market analysis notes will be saved and read from.'))
            .addText(text => text
                .setPlaceholder(DEFAULT_SETTINGS.analysisFolder)
                .setValue(this.plugin.settings.analysisFolder)
                .onChange(async (value) => {
                    this.plugin.settings.analysisFolder = value || DEFAULT_SETTINGS.analysisFolder;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: t('Automation Settings') });

        new Setting(containerEl)
            .setName(t('Enable Continuous K-Line Backfill'))
            .setDesc(t('If enabled, the plugin will silently download full K-line history for all your tracked symbols in the background.'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableKLineBackfill)
                .onChange(async (value) => {
                    this.plugin.settings.enableKLineBackfill = value;
                    await this.plugin.saveSettings();
                    // We might need to restart the service loop here, but usually a simple check in the loop is simpler or a reload.
                    // Ideally we expose a method to start/stop.
                    if (value) {
                        this.plugin.kLineDataService.startBackfillLoop();
                    } else {
                        this.plugin.kLineDataService.stopBackfillLoop();
                    }
                }));

        new Setting(containerEl)
            .setName(t('Automatic Sync Interval'))
            .setDesc(t('Set the interval in minutes for automatic background data synchronization. Set to 0 to disable.'))
            .addText(text => text
                .setPlaceholder(String(DEFAULT_SETTINGS.autoUpdateIntervalMinutes))
                .setValue(String(this.plugin.settings.autoUpdateIntervalMinutes))
                .onChange(async (value) => {
                    const interval = parseInt(value, 10);
                    if (!isNaN(interval) && interval >= 0) {
                        this.plugin.settings.autoUpdateIntervalMinutes = interval;
                        await this.plugin.saveSettings();
                    } else {
                        new Notice(t('Please enter a valid non-negative number for the interval.'));
                    }
                }));

        new Setting(containerEl)
            .setName(t('setting_force_full_sync_name'))
            .setDesc(t('setting_force_full_sync_desc'))
            .addButton(button => button
                .setButtonText(t('setting_clear_sync_cache_button'))
                .setWarning()
                .onClick(async () => {
                    new Notice(t('notice_sync_cache_cleared'));
                    await this.plugin.tradeSyncService.resetSyncState();
                    this.plugin.tradeSyncService.syncTrades(false);
                }));

        containerEl.createEl('h3', { text: t('Chart Indicators') });
        containerEl.createEl('p', { text: t('Manage your Moving Averages (MA) and Exponential Moving Averages (EMA).') });

        const customIndicatorsContainer = containerEl.createDiv();
        this.renderCustomIndicators(customIndicatorsContainer);

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText(t('Add New Custom Indicator'))
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.customIndicators.push({
                        id: Math.random().toString(36).substring(2, 9), // Simple unique ID
                        type: 'MA',
                        period: 20,
                        color: '#FF00FF',
                        title: t('Custom MA'),
                        enabled: true,
                    });
                    await this.plugin.saveSettings();
                    this.display(); // Re-render settings to show new indicator
                }));
    }

    private renderCustomIndicators(containerEl: HTMLElement) {
        containerEl.empty();
        this.plugin.settings.customIndicators.forEach((indicator, index) => {
            new Setting(containerEl)
                .setName(indicator.title || `${t('Custom Indicator')} ${index + 1}`)
                .addToggle(toggle => toggle
                    .setTooltip(t('Enable/Disable this custom indicator'))
                    .setValue(indicator.enabled)
                    .onChange(async (value) => {
                        indicator.enabled = value;
                        await this.plugin.saveSettings();
                    }))
                .addDropdown(dropdown => dropdown
                    .addOption('MA', t('Moving Average (MA)'))
                    .addOption('EMA', t('Exponential Moving Average (EMA)'))
                    .setValue(indicator.type)
                    .onChange(async (value: 'MA' | 'EMA') => {
                        indicator.type = value;
                        indicator.title = t(`Custom ${value}`);
                        await this.plugin.saveSettings();
                        this.display(); // Re-render to update title
                    }))
                .addText(text => text
                    .setPlaceholder(t('Period'))
                    .setValue(String(indicator.period))
                    .onChange(async (value) => {
                        const period = parseInt(value, 10);
                        if (!isNaN(period) && period > 0) {
                            indicator.period = period;
                            await this.plugin.saveSettings();
                        } else {
                            new Notice(t('Period must be a positive number.'));
                        }
                    }))
                .addColorPicker(color => color
                    .setValue(indicator.color)
                    .onChange(async (value) => {
                        indicator.color = value;
                        await this.plugin.saveSettings();
                    }))
                .addText(text => text
                    .setPlaceholder(t('Title'))
                    .setValue(indicator.title)
                    .onChange(async (value) => {
                        indicator.title = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText(t('Remove'))
                    .setClass('mod-warning')
                    .onClick(async () => {
                        this.plugin.settings.customIndicators.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display(); // Re-render settings
                    }));
        });
    }
}
