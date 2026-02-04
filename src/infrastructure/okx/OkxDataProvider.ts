
import { IDataAdapter } from '../../models/adapter.interface';
import { OkxApiClient } from './OkxApiClient';
import { OkxUMFuturesTradeProcessor } from './OkxUMFuturesTradeProcessor';
import { StandardizedTrade, TimelineEvent } from '../../models/types';
import { OkxFill, OkxBill, OkxInstrument, OkxPosition, OkxTicker } from './types';

declare const moment: any;

type RequestUrlFunc = (request: any) => Promise<any>;

import { IPersistenceAdapter } from '../../models/IPersistenceAdapter';

export class OkxDataProvider implements IDataAdapter {
    private apiClient: OkxApiClient;
    private processor: OkxUMFuturesTradeProcessor;
    private instrumentType: string;
    private requestLimit: number;
    private syncStartDate: string;
    private lastSyncTimestamp: number;
    private persistenceAdapter: IPersistenceAdapter; // [NEW]

    constructor(
        proxyUrl: string,
        requestUrl: RequestUrlFunc,
        instrumentType: string,
        requestLimit: number,
        syncStartDate: string,
        lastSyncTimestamp: number,
        persistenceAdapter: IPersistenceAdapter // [NEW] Dependency Injection
    ) {
        this.apiClient = new OkxApiClient(proxyUrl, requestUrl);
        this.processor = new OkxUMFuturesTradeProcessor(this.apiClient);
        this.instrumentType = instrumentType;
        this.requestLimit = requestLimit;
        this.syncStartDate = syncStartDate;
        this.lastSyncTimestamp = lastSyncTimestamp;
        this.persistenceAdapter = persistenceAdapter;
    }

    public async getStandardizedTrades(): Promise<StandardizedTrade[]> {
        console.log('[OkxDataProvider] getStandardizedTrades called');

        // 1. Load cached fills (open positions from last run)
        const cachedFills = await this.loadCachedFills();
        console.log(`[OkxDataProvider] Loaded ${cachedFills.length} cached fills.`);

        // 2. Fetch new data
        const allData = await this.fetchAllData();

        // 3. Merge: Cached Fills + New Fills
        // Note: New fills are fetched based on `lastSyncTimestamp`. 
        // Cached fills are from positions that were OPEN at that time.
        // It's possible we re-fetch some fills if timestamps overlap, but processor handles duplicates?
        // Actually, logic is: allData.fills only contains NEW fills > lastSyncTimestamp.
        // Cached fills contains OLD fills <= lastSyncTimestamp for open positions.
        // So they shouldn't overlap much, but `processAllData` sorts them by time.
        // However, we must ensure unique fills to avoid duplicaton artifacts if any.
        // The processor key is (instId, timestamp, tradeId).
        // Let's filter duplicates just in case? 
        // Simplest way: Concatenate and let processor sort.
        // But processor blindly processes everything. `TradeBuilder` handles logic.
        // `OkxTradeBuilder` doesn't check for duplicate tradeIds explicitly but relies on `addFill`.
        // Ideally we dedupe by tradeId.

        const mergedFills = this.deduplicateFills([...cachedFills, ...allData.fills]);

        // 4. Process
        const result = await this.processor.processAllData(
            mergedFills,
            allData.bills,
            allData.instruments,
            allData.positions
        );

        // 5. Update Cache with currently OPEN position fills
        const openFills = this.processor.getOpenPositionFills();
        await this.saveCachedFills(openFills);
        console.log(`[OkxDataProvider] Saved ${openFills.length} fills to cache.`);

        return result;
    }

    private deduplicateFills(fills: OkxFill[]): OkxFill[] {
        const unique = new Map<string, OkxFill>();
        for (const fill of fills) {
            // Use tradeId as unique key if available, else fallback
            const key = fill.tradeId || `${fill.instId}-${fill.ts}-${fill.side}`;
            unique.set(key, fill);
        }
        return Array.from(unique.values());
    }

    private async loadCachedFills(): Promise<OkxFill[]> {
        if (!this.persistenceAdapter) return [];
        try {
            const data = await this.persistenceAdapter.load('okx-fill-cache');
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error('Failed to load fill cache', e);
            return [];
        }
    }

    private async saveCachedFills(fills: OkxFill[]): Promise<void> {
        if (!this.persistenceAdapter) return;
        await this.persistenceAdapter.save('okx-fill-cache', fills);
    }

    public setLastSyncTimestamp(timestamp: number): void {
        this.lastSyncTimestamp = timestamp;
    }

    public async getTickerPrice(symbol: string): Promise<number> {
        const ticker = await this.apiClient.getTicker(symbol);
        return parseFloat(ticker.last);
    }

    private async fetchAllData(): Promise<{ fills: OkxFill[], bills: OkxBill[], instruments: OkxInstrument[], positions: OkxPosition[] }> {
        let parsedStartDate: number | undefined = undefined;
        if (this.syncStartDate) {
            const momentDate = moment(this.syncStartDate, 'YYYY-MM-DD');
            if (momentDate.isValid()) {
                parsedStartDate = momentDate.valueOf();
            } else {
                console.warn(`Invalid sync start date format: ${this.syncStartDate}.`);
            }
        }

        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        // User requested to limit only to 2 weeks
        const effectiveStartDate = Math.max(parsedStartDate || 0, this.lastSyncTimestamp || 0, twoWeeksAgo);

        // Fetch Fills
        const fills = await this._fetchFillsLoop(effectiveStartDate);

        // Fetch Bills (Funding Fees)
        const bills = await this._fetchBillsLoop(effectiveStartDate);

        // Get Unique InstIds from fills and bills to fetch instruments?
        // Actually OKX getInstruments returns all for a type (SWAP). It's efficient enough to fetch all SWAP instruments once.
        const instruments = await this.apiClient.getInstrument('SWAP'); // Assuming U-based/Swap

        // Fetch Positions
        const positions = await this.apiClient.getPositions('SWAP');

        return { fills, bills, instruments, positions };
    }

    private async _fetchFillsLoop(minTimestamp: number): Promise<OkxFill[]> {
        let allFills: OkxFill[] = [];
        let afterCursor: string | undefined = undefined;
        let hasMore = true;

        while (hasMore) {
            // Fetch page
            const fills = await this.apiClient.getFills('SWAP', undefined, afterCursor, this.requestLimit);

            if (fills.length === 0) {
                hasMore = false;
                break;
            }

            // check logs
            // OKX returns newest first.
            let keepGoing = true;
            for (const fill of fills) {
                const ts = parseInt(fill.ts);
                if (ts > minTimestamp) {
                    // Filter: Trust the API response which requested 'SWAP'. 
                    // This allows both USDT-margined (BTC-USDT-SWAP) and Coin-margined (BTC-USD-SWAP).
                    allFills.push(fill);
                } else {
                    keepGoing = false; // Found a fill older than allowed, stop adding and stop fetching
                }
            }

            if (!keepGoing || fills.length < this.requestLimit) {
                hasMore = false;
            } else {
                // Prepare next cursor
                afterCursor = fills[fills.length - 1].billId; // billId is used for pagination in fills? Doc says 'billId' for bills, 'billId' or 'ordId'? 
                // For fills, it uses 'billId' as cursor? No, fills endpoint uses 'billId' if provided?
                // Documentation says `after` is the ID of the last result. 
                // For fills, the ID field is `billId`? No, Fills have `billId` (if trade fill) or `tradeId`?
                // Actually Fills endpoint returns `billId` as the ID for pagination in some contexts, or `tradeId`?
                // OKX API Docs: "after": "Pass the billId of the last result". So yes, `billId`.
                // Wait, verify OkxFill type has billId.
                if (fills[fills.length - 1].billId) {
                    afterCursor = fills[fills.length - 1].billId;
                } else {
                    // Fallback or error?
                    hasMore = false;
                }
            }
        }
        return allFills;
    }

    private async _fetchBillsLoop(minTimestamp: number): Promise<OkxBill[]> {
        let allBills: OkxBill[] = [];
        let afterCursor: string | undefined = undefined;
        let hasMore = true;

        while (hasMore) {
            // Type '8' is funding fee
            const bills = await this.apiClient.getBills('SWAP', '8', afterCursor, this.requestLimit);

            if (bills.length === 0) {
                hasMore = false;
                break;
            }

            let keepGoing = true;
            for (const bill of bills) {
                const ts = parseInt(bill.ts);
                if (ts > minTimestamp) {
                    // Filter: Trust the API response which requested 'SWAP'.
                    // Allow bills for both U-based and Coin-based.
                    allBills.push(bill);
                } else {
                    keepGoing = false;
                }
            }

            if (!keepGoing || bills.length < this.requestLimit) {
                hasMore = false;
            } else {
                if (bills[bills.length - 1].billId) {
                    afterCursor = bills[bills.length - 1].billId;
                } else {
                    hasMore = false;
                }
            }
        }
        return allBills;
    }
}
