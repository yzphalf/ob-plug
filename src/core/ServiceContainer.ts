import { App } from "obsidian";
import { MyPluginSettings } from "../infrastructure/obsidian/settings";
import { ChartingService } from "../services/ChartingService";
import { IndicatorService } from "../services/IndicatorService";
import { KLineDataService } from "../services/KLineDataService";
import { SymbolService } from "../services/SymbolService";
import { TradeSyncService } from "../services/TradeSyncService";
import { AnalysisService } from "../services/AnalysisService";
import { IDataAdapter } from "../models/adapter.interface";
import { OkxDataProvider } from "../infrastructure/okx/OkxDataProvider";
import { BinanceDataProvider } from "../infrastructure/binance/BinanceDataProvider";
import { ObsidianPersistenceAdapter } from "../infrastructure/obsidian/ObsidianPersistenceAdapter";
import { requestUrl } from "obsidian";

/**
 * 服务容器 (Service Container)
 * 
 * 这是一个简单的依赖注入容器 (IoC Container)，负责：
 * 1. 单例管理：确保整个应用中每个服务只有一个实例。
 * 2. 依赖解析：集中处理服务之间的依赖关系。
 * 3. 懒加载：某些服务可以在需要时才初始化（当前实现为立即初始化）。
 */
export class ServiceContainer {
    public symbolService: SymbolService;
    public indicatorService: IndicatorService;
    public chartingService: ChartingService;
    public tradeSyncService: TradeSyncService;
    public kLineDataService: KLineDataService;
    public analysisService: AnalysisService;

    private app: App;
    private plugin: any; // We use 'any' to avoid circular import issues if MyPlugin imports ServiceContainer
    // Ideally we define an interface 'IPlugin' or just import MyPlugin but that creates cycle.
    // For now, type as 'any' or 'Plugin' from obsidian.
    private settings: MyPluginSettings;
    private saveSettingsCallback: () => Promise<void>;

    constructor(app: App, plugin: any, settings: MyPluginSettings, saveSettingsCallback: () => Promise<void>) {
        this.app = app;
        this.plugin = plugin;
        this.settings = settings;
        this.saveSettingsCallback = saveSettingsCallback;

        this.initializeServices();
    }

    private initializeServices() {
        // 1. Core independent services
        this.symbolService = new SymbolService(this.app);
        this.indicatorService = new IndicatorService();
        this.analysisService = new AnalysisService(this.app, this.settings);

        // 2. Data Provider
        const dataProvider = this.createDataProvider();

        // 3. Dependent services
        this.tradeSyncService = new TradeSyncService(
            this.app,
            dataProvider,
            this.settings,
            this.saveSettingsCallback,
            this.symbolService
        );

        this.kLineDataService = new KLineDataService(
            this.app,
            this.plugin,
            this.settings
        );
        this.kLineDataService.setSymbolService(this.symbolService);

        this.chartingService = new ChartingService(this.app, this.symbolService);
    }

    /**
     * 根据设置创建相应的数据提供者
     */
    public createDataProvider(): IDataAdapter {
        if (this.settings.exchange === 'OKX') {
            // Use plugin's manifest dir or a standard data dir
            // Since we don't have easy access to manifest.dir without 'Plugin' object typing,
            // we can use a safe default relative to vault root.
            // Standard: .obsidian/plugins/ob-plug/data (or similar)
            // Better: Use `this.plugin.manifest.dir` if available, or just hardcode if we know the ID or pass it.
            let pluginDir = '.obsidian/plugins/ob-plug'; // Default fallback
            if (this.plugin && this.plugin.manifest && this.plugin.manifest.dir) {
                pluginDir = this.plugin.manifest.dir;
            }
            // Actually, we can store it in the plugin directory.

            const persistenceAdapter = new ObsidianPersistenceAdapter(this.app, pluginDir);

            // Use okxProxyUrl if available, otherwise fallback (or empty if not needed by specific provider logic)
            // But strict typing requires string.
            const proxyUrl = this.settings.okxProxyUrl || this.settings.binanceProxyUrl;

            return new OkxDataProvider(
                proxyUrl,
                requestUrl,
                'SWAP',
                this.settings.requestLimit,
                this.settings.syncStartDate,
                this.settings.lastSyncTimestampOkx,
                persistenceAdapter
            );
        } else {
            return new BinanceDataProvider(
                this.settings.binanceProxyUrl,
                requestUrl,
                this.settings.instrumentType,
                this.settings.requestLimit,
                this.settings.syncStartDate,
                this.settings.lastSyncTimestampBinance
            );
        }
    }

    /**
     * 更新数据提供者 (当用户切换交易所时调用)
     */
    public updateDataProvider() {
        const dataProvider = this.createDataProvider();
        this.tradeSyncService.setDataProvider(dataProvider);
        this.kLineDataService.reloadClient();
        console.log(`[ServiceContainer] Data Provider updated to: ${this.settings.exchange}`);
    }
}
