import { App, Notice, Plugin, requestUrl } from 'obsidian';
import { MyPluginSettings } from '../infrastructure/obsidian/settings';
import { BinanceApiClient } from '../infrastructure/binance/BinanceApiClient';
import { OkxApiClient } from '../infrastructure/okx/OkxApiClient';
import { ApiClient } from '../models/adapter.interface';
import { SymbolService } from './SymbolService';

// Compact format: [time, open, high, low, close, volume]
// All are numbers. Time is in milliseconds.
export type CompactCandle = [number, number, number, number, number, number];

export class KLineDataService {
    private app: App;
    private plugin: Plugin;
    private settings: MyPluginSettings;
    private apiClient: ApiClient;
    private symbolService: SymbolService | null = null;
    private loopActive = false;
    private listeners: ((symbol: string, interval: string) => void)[] = [];

    // Concurrency control
    private queue: { symbol: string; interval: string; startTime?: number; priority: boolean }[] = [];
    private activeDownloads = 0;
    private readonly MAX_CONCURRENT_DOWNLOADS = 3;
    private statusBarItem: HTMLElement | null = null;
    private totalTasks = 0;
    private completedTasks = 0;

    constructor(app: App, plugin: Plugin, settings: MyPluginSettings) {
        this.app = app;
        this.plugin = plugin;
        this.settings = settings;
        this.initApiClient();
    }

    public reloadClient() {
        this.initApiClient();
        console.log(`[KLineDataService] Reloaded client for exchange: ${this.settings.exchange}`);
    }

    private initApiClient() {
        if (this.settings.exchange === 'OKX') {
            const proxyUrl = this.settings.okxProxyUrl || 'https://your-proxy.vercel.app/api/okx';
            this.apiClient = new OkxApiClient(proxyUrl, requestUrl);
        } else {
            this.apiClient = new BinanceApiClient(this.settings.binanceProxyUrl, requestUrl);
        }
    }

    private toBinanceSymbol(symbol: string): string {
        // If OKX, we usually use the symbol as is (e.g. BTC-USDT-SWAP)
        if (this.settings.exchange === 'OKX') {
            return symbol;
        }

        // Helper to convert OKX symbol (e.g. BTC-USDT-SWAP) to Binance symbol (BTCUSDT)
        if (symbol.includes('-')) {
            const parts = symbol.split('-');
            if (parts.length >= 2) {
                return `${parts[0]}${parts[1]}`;
            }
        }
        return symbol; // Return as is if already likely compatible or unknown format
    }

    public setStatusBarItem(item: HTMLElement) {
        this.statusBarItem = item;
        this.updateStatusBar();
    }

    private updateStatusBar() {
        if (!this.statusBarItem) return;

        if (this.queue.length === 0 && this.activeDownloads === 0) {
            this.statusBarItem.setText('');
            return;
        }

        this.statusBarItem.setText(`K-Line Sync: ${this.activeDownloads} active, ${this.queue.length} queued`);
    }

    public setSymbolService(symbolService: SymbolService) {
        this.symbolService = symbolService;
    }

    public startBackfillLoop() {
        if (this.loopActive) return;
        this.loopActive = true;
        console.log('[KLineCache] Background loop started.');
        this.runDispatcher();

        // Initial population of the queue
        if (this.symbolService) {
            const symbols = this.symbolService.getSymbolsFromVault();
            symbols.forEach(s => this.addToQueue(s, '30m', undefined, false)); // Low priority raw sync
        }
    }

    public stopBackfillLoop() {
        this.loopActive = false;
        console.log('[KLineCache] Background loop stopped.');
    }

    private addToQueue(symbol: string, interval: string, startTime?: number, priority: boolean = false) {
        // Check if already in queue or processing (simple check)
        // For simplicity, we just push. De-duplication can happen at processing time if needed.
        if (priority) {
            this.queue.unshift({ symbol, interval, startTime, priority });
        } else {
            this.queue.push({ symbol, interval, startTime, priority });
        }
        this.updateStatusBar();
        this.runDispatcher();
    }

    private async runDispatcher() {
        if (!this.loopActive) return;

        while (this.activeDownloads < this.MAX_CONCURRENT_DOWNLOADS && this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                this.activeDownloads++;
                this.updateStatusBar();
                this.processTask(task).finally(() => {
                    this.activeDownloads--;
                    this.updateStatusBar();
                    this.runDispatcher();
                });
            }
        }
    }

    private async processTask(task: { symbol: string; interval: string; startTime?: number; priority: boolean }) {
        const { symbol, interval, startTime } = task;
        try {
            const currentCache = await this.readCacheFile(symbol, interval);
            await this.backgroundSync(symbol, interval, currentCache, startTime);
        } catch (e) {
            console.error(`[KLineDataService] Task failed for ${symbol}`, e);
        }
    }

    public onDataUpdate(callback: (symbol: string, interval: string) => void) {
        this.listeners.push(callback);
    }

    private notifyListeners(symbol: string, interval: string) {
        this.listeners.forEach(cb => cb(symbol, interval));
    }

    public async getCachedKLines(symbol: string, interval: string, startTime?: number): Promise<CompactCandle[]> {
        let fileContent = await this.readCacheFile(symbol, interval);
        let needSave = false;
        let fetchedData: CompactCandle[] = [];

        // Critical path: If totally empty, fetch immediately (blocking UI essentially, but async)
        if (!fileContent || fileContent.length === 0) {
            console.log(`[KLineDataService] Cache missing for ${symbol} ${interval}. Fetching initial data...`);
            // new Notice(`Fetching K-Line data for ${symbol}...`); // Removed per user request

            try {
                if (startTime) {
                    fetchedData = await this.fetchRange(symbol, interval, startTime);
                } else {
                    const binanceSymbol = this.toBinanceSymbol(symbol);
                    const data = await this.apiClient.getCandles(binanceSymbol, interval, undefined, undefined, 1000);
                    if (data && data.length > 0) {
                        fetchedData = this.mapCandles(data);
                    }
                }
                if (fetchedData.length > 0) needSave = true;
            } catch (error) {
                console.error(`[KLineDataService] Failed to fetch initial data for ${symbol}`, error);
                new Notice(`Failed to fetch K-Line data for ${symbol}`);
            }
        }
        // Scenario 2: Cache exists, but we need older data requested specifically
        else if (startTime && startTime < fileContent[0][0]) {
            console.log(`[KLineDataService] Cache starts at ${fileContent[0][0]}, need ${startTime}. Fetching missing history immediately...`);
            // new Notice(`Fetching historical K-Line data...`); // Removed per user request
            try {
                // Critical: Await this immediately so the view gets data
                fetchedData = await this.fetchRange(symbol, interval, startTime);
                if (fetchedData.length > 0) {
                    needSave = true;
                    // Also toggle high priority backfill for MORE history if needed
                    this.addToQueue(symbol, interval, startTime, true);
                }
            } catch (error) {
                console.error(`[KLineDataService] Failed to fetch historical data for ${symbol}`, error);
            }
        }

        if (needSave && fetchedData.length > 0) {
            fileContent = this.mergeCandles(fileContent || [], fetchedData);
            await this.writeCacheFile(symbol, interval, fileContent);
        }

        // Always trigger a background sync check for this symbol (Update Head / consistency)
        // Low priority if we just fetched, but good for completeness
        this.addToQueue(symbol, interval, undefined, false);

        return fileContent;
    }

    private getCacheFilePath(symbol: string, interval: string): string {
        const pluginDir = this.plugin.manifest.dir || '';
        const dataFolder = `${pluginDir}/kline_data`;
        return `${dataFolder}/${symbol}_${interval}.json`;
    }

    private getCacheFolderPath(): string {
        const pluginDir = this.plugin.manifest.dir || '';
        return `${pluginDir}/kline_data`;
    }

    private async readCacheFile(symbol: string, interval: string): Promise<CompactCandle[]> {
        const filePath = this.getCacheFilePath(symbol, interval);
        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const content = await this.app.vault.adapter.read(filePath);
                return JSON.parse(content) as CompactCandle[];
            }
        } catch (e) {
            console.error(`Failed to read cache for ${symbol}:`, e);
        }
        return [];
    }

    private async writeCacheFile(symbol: string, interval: string, data: CompactCandle[]) {
        const filePath = this.getCacheFilePath(symbol, interval);
        const folderPath = this.getCacheFolderPath();

        try {
            if (!(await this.app.vault.adapter.exists(folderPath))) {
                await this.app.vault.adapter.mkdir(folderPath);
            }
            await this.app.vault.adapter.write(filePath, JSON.stringify(data));
            this.notifyListeners(symbol, interval);
        } catch (e) {
            console.error(`Failed to write cache for ${symbol}:`, e);
        }
    }

    /**
     * Core Sync Logic
     */
    private async backgroundSync(symbol: string, interval: string, currentCache: CompactCandle[], targetStartTime?: number) {
        // 1. Update Head (Latest data)
        let updatedCache = [...currentCache];
        let lastTime = 0;
        if (updatedCache.length > 0) {
            lastTime = updatedCache[updatedCache.length - 1][0];
        }

        const intervalMs = this.intervalToMs(interval);
        // If gap > 2 * interval, fetch recent
        if (Date.now() - lastTime > intervalMs * 2) {
            try {
                const recentData = await this.fetchRange(symbol, interval, lastTime + 1);
                if (recentData.length > 0) {
                    updatedCache = this.mergeCandles(updatedCache, recentData);
                    await this.writeCacheFile(symbol, interval, updatedCache);
                }
            } catch (e) {
                console.warn("Failed to update head for " + symbol);
            }
        }

        // 2. Backfill Tail (History)
        // If targetStartTime is provided, we loop until we cover it.
        // If not, we just do one chunk of "older".

        // Define safe limit (e.g., 2018) OR use targetStartTime
        const SAFE_START_DATE = new Date('2018-01-01').getTime();
        const effectiveTarget = targetStartTime || SAFE_START_DATE;

        let firstTime = updatedCache.length > 0 ? updatedCache[0][0] : Date.now();

        if (firstTime > effectiveTarget) {
            console.log(`[KLineDataService] Backfilling ${symbol} from ${new Date(firstTime).toISOString()} target ${new Date(effectiveTarget).toISOString()}`);

            try {
                // Fetch previous 1000
                const binanceSymbol = this.toBinanceSymbol(symbol);
                const olderData = await this.apiClient.getCandles(binanceSymbol, interval, undefined, firstTime - 1, 1000);

                if (olderData && olderData.length > 0) {
                    const mappedOlder = this.mapCandles(olderData);
                    updatedCache = this.mergeCandles(mappedOlder, updatedCache);
                    await this.writeCacheFile(symbol, interval, updatedCache);

                    // Recursive Step: If we are still not at target, queue another task!
                    // This creates the "continuous download" effect.
                    const newFirstTime = updatedCache[0][0];
                    if (newFirstTime > effectiveTarget && mappedOlder.length >= 500) { // If we got a decent chunk, there's likely more
                        // Add to HEAD of queue to finish this symbol faster? Or tail to be fair?
                        // Let's add to HEAD (priority=true) if we have a specific target, else tail.
                        const keepGoing = !!targetStartTime;
                        this.addToQueue(symbol, interval, targetStartTime, keepGoing);
                    }
                } else {
                    console.log(`[KLineDataService] No more data for ${symbol}`);
                }
            } catch (e) {
                console.error("Backfill failed for " + symbol, e);
            }
        }
    }

    private mapCandles(raw: any[]): CompactCandle[] {
        return raw.map(c => [
            parseInt(c.ts),
            parseFloat(c.o),
            parseFloat(c.h),
            parseFloat(c.l),
            parseFloat(c.c),
            parseFloat(c.vol)
        ] as CompactCandle);
    }

    private mergeCandles(oldData: CompactCandle[], newData: CompactCandle[]): CompactCandle[] {
        const map = new Map<number, CompactCandle>();
        oldData.forEach(c => map.set(c[0], c));
        newData.forEach(c => map.set(c[0], c));
        return Array.from(map.values()).sort((a, b) => a[0] - b[0]);
    }

    private fetchRange(symbol: string, interval: string, startTime: number): Promise<CompactCandle[]> {
        // limit 1000
        const binanceSymbol = this.toBinanceSymbol(symbol);
        return this.apiClient.getCandles(binanceSymbol, interval, startTime, undefined, 1000)
            .then(data => this.mapCandles(data));
    }

    private intervalToMs(interval: string): number {
        const value = parseInt(interval.slice(0, -1));
        const unit = interval.slice(-1);
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            case 'M': return value * 30 * 24 * 60 * 60 * 1000;
            default: return 15 * 60 * 1000;
        }
    }
}
