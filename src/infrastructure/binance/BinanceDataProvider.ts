/**
 * Binance 数据提供者 (Binance Data Provider)
 *
 * 采用了“适配器模式” (Adapter Pattern)。它将底层的 `BinanceApiClient` 包装起来，
 * 对外提供符合插件标准接口 (`IDataProvider`) 的数据。
 *
 * 主要功能：
 * 1. 组合调用：它知道要获取一次完整的“同步数据”，需要先调 API 拿成交单，再调 API 拿资金费，最后拿持仓信息。它把这些琐碎的步骤封装成一个大方法 (`fetchAllData`)。
 * 2. 分页处理：币安的 API 一次只给 1000 条，这个类负责写 `while` 循环，自动一页页翻到头，确保数据不遗漏。
 * 3. 增量控制：管理 `lastSyncTimestamp`，计算出下次该从哪一秒开始拉数据。
 */
import { requestUrl } from 'obsidian';
import { IDataAdapter } from '../../models/adapter.interface';
import { BinanceApiClient } from './BinanceApiClient';
import { BinanceUMFuturesTradeProcessor } from './BinanceUMFuturesTradeProcessor';
import { StandardizedTrade, RawFill, Bill, InstrumentDetail, RawPositionRisk } from '../../models/types';

declare const moment: any; // For date parsing

// Define the shape of the requestUrl function and its parameters, which will be injected by the plugin main logic.
type RequestUrlFunc = (request: any) => Promise<any>;

/**
 * Implements the "Composition" approach as requested.
 * This class acts as a provider that composes the existing ApiClient and Processor
 * to deliver standardized data, without modifying the original components.
 */
export class BinanceDataProvider implements IDataAdapter {
    private apiClient: BinanceApiClient;
    private processor: BinanceUMFuturesTradeProcessor;
    private instrumentType: string;
    private requestLimit: number;
    private syncStartDate: string;
    private lastSyncTimestamp: number;

    constructor(
        proxyUrl: string,
        requestUrl: RequestUrlFunc,
        instrumentType: string,
        requestLimit: number,
        syncStartDate: string,
        lastSyncTimestamp: number
    ) {
        this.apiClient = new BinanceApiClient(proxyUrl, requestUrl);
        this.processor = new BinanceUMFuturesTradeProcessor(this.apiClient);
        this.instrumentType = instrumentType;
        this.requestLimit = requestLimit;
        this.syncStartDate = syncStartDate;
        this.lastSyncTimestamp = lastSyncTimestamp;
    }

    /**
     * The single public method that fulfills the IDataAdapter contract.
     * It orchestrates fetching all necessary data using the original ApiClient,
     * then processes it using the original Processor.
     * @returns A promise that resolves to an array of StandardizedTrade objects.
     */
    public async getStandardizedTrades(): Promise<StandardizedTrade[]> {
        // This logic is moved from the original main.ts's `syncTrades` and `fetchAllData` methods.
        const allData = await this.fetchAllData();
        const standardizedTrades = await this.processor.processAllData(
            allData.fills,
            allData.bills,
            allData.instrumentDetails,
            allData.positionRisks
        );
        return standardizedTrades;
    }

    public setLastSyncTimestamp(timestamp: number): void {
        this.lastSyncTimestamp = timestamp;
    }

    public async getTickerPrice(symbol: string): Promise<number> {
        return this.apiClient.getTickerPrice(symbol);
    }

    /**
     * Private helper method to fetch all necessary raw data from the ApiClient, with support for pagination.
     */
    private async fetchAllData(): Promise<{ fills: RawFill[], bills: Bill[], instrumentDetails: InstrumentDetail[], positionRisks: RawPositionRisk[] }> {
        let parsedStartDate: number | undefined = undefined;
        if (this.syncStartDate) {
            const momentDate = moment(this.syncStartDate, 'YYYY-MM-DD');
            if (momentDate.isValid()) {
                parsedStartDate = momentDate.valueOf();
            } else {
                console.warn(`Invalid sync start date format: ${this.syncStartDate}. Ignoring.`);
            }
        }

        const effectiveStartDate = Math.max(parsedStartDate || 0, this.lastSyncTimestamp || 0);
        const startTimestamp = effectiveStartDate > 0 ? effectiveStartDate : undefined;

        if (startTimestamp) {
            console.log(`Starting incremental sync from: ${new Date(startTimestamp).toISOString()}`);
        } else {
            console.log('Performing full sync of all history.');
        }

        // Fetch all pages of fills (userTrades are ascending)
        const fills = await this._fetchAllPaginated(
            (params) => this.apiClient.getFillsHistory(this.instrumentType, undefined, params.startTime || startTimestamp, undefined, this.requestLimit),
            'asc'
        );

        if (fills.length === 0) {
            console.warn('No new trades found since last sync. Nothing to process.');
            return { fills: [], bills: [], instrumentDetails: [], positionRisks: [] };
        }

        // Unique instrument IDs must be derived after all fills are fetched
        const uniqueInstIds = [...new Set(fills.map(fill => fill.instId))];

        // Fetch all pages of bills (income is descending, but we fetch from start date and reverse)
        const bills = await this._fetchAllPaginated(
            (params) => this.apiClient.getBillsHistory(this.instrumentType, undefined, params.startTime || startTimestamp, undefined, this.requestLimit),
            'asc' // Treat as ascending since we provide a start time
        );

        // Fetch position risks and instrument details concurrently
        // Optimization: Fetch ALL instruments once instead of N times.
        const [positionRisks, allInstruments] = await Promise.all([
            this.apiClient.getPositionsRisk(),
            this.apiClient.getAllInstruments(this.instrumentType)
        ]);

        // Filter instruments to only those relevant to the trades? 
        // Not strictly necessary as the processor will index them, but cleaner.
        // Actually, keeping all is better for potential future lookups or reducing logic.
        // Just pass allInstruments.
        const instrumentDetails = allInstruments;

        return { fills, bills, instrumentDetails, positionRisks };
    }

    /**
     * Generic helper to fetch all pages from a paginated endpoint.
     * @param apiCall The API client method to call, which accepts startTime or endTime.
     * @param order The order in which the API returns data ('asc' or 'desc').
     * @returns A promise that resolves to an array of all items fetched.
     */
    private async _fetchAllPaginated<T extends { ts: string }>(
        apiCall: (params: { startTime?: number, endTime?: number }) => Promise<T[]>,
        order: 'asc' | 'desc'
    ): Promise<T[]> {
        let allResults: T[] = [];
        let currentTimestamp: number | undefined = undefined; // Renamed from lastTimestamp to avoid confusion
        let hasMore = true;

        while (hasMore) {
            const params: { startTime?: number, endTime?: number } = {};
            if (currentTimestamp !== undefined) {
                if (order === 'asc') {
                    params.startTime = currentTimestamp;
                } else {
                    params.endTime = currentTimestamp;
                }
            }

            const results = await apiCall(params);
            if (results.length > 0) {
                allResults.push(...results);
                const lastItem = results[results.length - 1];
                currentTimestamp = parseInt(lastItem.ts) + (order === 'asc' ? 1 : -1);
            }

            if (results.length < this.requestLimit) {
                hasMore = false;
            }
        }

        // If descending, reverse the final array to be in chronological order
        if (order === 'desc') {
            allResults.reverse();
        }

        return allResults;
    }
}
