
import { requestUrl } from 'obsidian';
import { OkxBill, OkxFill, OkxInstrument, OkxPosition, OkxTicker, Candle } from './types';

type RequestUrlFunc = (request: any) => Promise<any>;

export class OkxApiClient {
    private proxyUrl: string;
    private requestUrlFunc: RequestUrlFunc;
    // Keys are managed by the proxy server now.

    constructor(
        proxyUrl: string,
        requestUrlFunc: RequestUrlFunc
    ) {
        this.proxyUrl = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl;
        this.requestUrlFunc = requestUrlFunc;
    }

    private async makeRequest<T>(method: 'GET' | 'POST', endpoint: string, params: Record<string, any> = {}): Promise<T> {
        // Construct URL: proxyUrl + /okx + endpoint
        // Users might set proxyUrl to base (e.g. https://foo.vercel.app) or with suffix.
        // We ensure requests go to /okx/... so vercel.json rewrites them to api/okx.js

        let baseUrl = this.proxyUrl;
        // If proxyUrl doesn't end with /okx, we append it.
        // We also check if endpoint itself starts with /okx to avoid duplication (though unlikely for defined endpoints).
        if (!baseUrl.endsWith('/okx') && !endpoint.startsWith('/okx')) {
            baseUrl += '/okx';
        }

        let url = `${baseUrl}${endpoint}`;
        let body = '';
        let queryString = '';

        if (method === 'GET' && Object.keys(params).length > 0) {
            const sp = new URLSearchParams();
            Object.keys(params).forEach(key => sp.append(key, params[key].toString()));
            queryString = '?' + sp.toString();
            url += queryString;
        } else if (method === 'POST') {
            body = JSON.stringify(params);
        }

        console.log(`[OkxApiClient] Fetching from: ${url}`);

        const requestParams = {
            url: url,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: method === 'POST' ? body : undefined,
        };

        try {
            const response = await this.requestUrlFunc(requestParams);
            if (response.status >= 400) {
                const errorData = response.json || { msg: `HTTP Error ${response.status}` };
                throw new Error(`OKX API request failed: ${JSON.stringify(errorData)}`);
            }

            const jsonResponse = response.json;
            if (jsonResponse.code && jsonResponse.code !== '0') {
                throw new Error(`OKX API Error ${jsonResponse.code}: ${jsonResponse.msg}`);
            }
            return jsonResponse.data as T;
        } catch (error) {
            console.error(`Failed to fetch from ${endpoint}:`, error);
            throw error;
        }
    }

    /**
     * Get Fills History (last 3 months usually, or archive for older)
     * OKX V5: GET /api/v5/trade/fills
     * Pagination: before/after (cursor based).
     * 'after': Requesting data older than this ID.
     * 'before': Requesting data newer than this ID.
     * To traverse backwards (newest to oldest), we use 'after'.
     */
    async getFills(instType: string, instId?: string, after?: string, limit: number = 100): Promise<OkxFill[]> {
        const params: Record<string, any> = {
            instType,
            limit: limit.toString(),
        };
        if (instId) params.instId = instId;
        if (after) params.after = after;

        return this.makeRequest<OkxFill[]>('GET', '/api/v5/trade/fills-history', params);
    }

    /**
     * Get Bills (Income) History
     * OKX V5: GET /api/v5/account/bills
     * Type 8 = Funding Fee
     */
    async getBills(instType: string, type: string = '8', after?: string, limit: number = 100): Promise<OkxBill[]> {
        const params: Record<string, any> = {
            instType,
            type, // 8 for funding fee
            limit: limit.toString(),
        };
        if (after) params.after = after;

        // Use bills-archive for older execution if needed, but let's stick to standard bills for now (7 days - 3 months depending on endpoint)
        // /api/v5/account/bills-archive supports up to 3 months or more.
        return this.makeRequest<OkxBill[]>('GET', '/api/v5/account/bills-archive', params);
    }

    async getInstrument(instType: string, instId?: string): Promise<OkxInstrument[]> {
        const params: Record<string, any> = {
            instType,
        };
        if (instId) params.instId = instId;
        return this.makeRequest<OkxInstrument[]>('GET', '/api/v5/public/instruments', params);
    }

    async getPositions(instType: string, instId?: string): Promise<OkxPosition[]> {
        const params: Record<string, any> = {
            instType,
        };
        if (instId) params.instId = instId;
        return this.makeRequest<OkxPosition[]>('GET', '/api/v5/account/positions', params);
    }

    async getTicker(instId: string): Promise<OkxTicker> {
        const params = { instId };
        const data = await this.makeRequest<OkxTicker[]>('GET', '/api/v5/market/ticker', params);
        return data[0];
    }

    /**
     * Get Candles (K-Line)
     * OKX V5: GET /api/v5/market/candles (recent) or /api/v5/market/history-candles (older)
     * We'll use history-candles to be safe for backfill.
     * Params: instId, bar (interval), after, before, limit
     */
    async getCandles(symbol: string, interval: string, startTime?: number, endTime?: number, limit: number = 100): Promise<Candle[]> {
        // Map interval: OKX uses 'bar' param. 
        // 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M
        // Our plugin uses '30m' etc.
        // Note: OKX uses '1H' (uppercase) for hourly. Plugin usually uses lowercase '1h'. Need to map if needed.
        // Check KLineDataService intervalToMs, it handles 'h', 'd', 'w', 'M'.
        let bar = interval;
        if (interval.endsWith('h')) bar = interval.replace('h', 'H'); // 1h -> 1H

        const params: Record<string, any> = {
            instId: symbol,
            bar: bar,
            limit: limit.toString(),
        };

        // Pagination/Time range
        // OKX 'after' gets OLDER data (ts < after). 'before' gets NEWER (ts > before).
        // If startTime is provided, we want data >= startTime.
        // If endTime is provided, we want data <= endTime.
        // OKX returns NEWEST first.

        // This signature is tricky because Binance allows explicit startTime/endTime.
        // OKX is cursor based mostly. But we can use 'after' to page backwards.
        // However, if we want specific time range:
        // If endTime is provided, use it as 'after' (approx)? No, 'after' is exclusive.
        // Actually for correct "backfill history" behavior (paging backwards):
        // We usually pass 'endTime' as the starting point to look back from.
        if (endTime) {
            params.after = endTime.toString();
        }

        // What if only startTime is provided? We can't easily jump to a start time in OKX without iterating?
        // Actually /history-candles implies we can just page back.
        // If KLineDataService asks for `startTime`... it might expect data *starting* from there?
        // KLineDataService::fetchRange uses: apiClient.getCandles(..., startTime, undefined, 1000)
        // .then(data => this.mapCandles(data));
        // And `mapCandles` expects `[ts, o, h, l, c, vol]`.

        // OKX Response: [ts, o, h, l, c, vol, ...] (strings)

        const endpoint = '/api/v5/market/history-candles'; // Use history by default for flexibility

        // Handling the "startTime" parameter which implies "fetch oldest first" or "fetch from specific point"?
        // If KLineDataService asks for startTime, it wants data growing forward from that time?
        // OR it wants a chunk that includes that time?
        // Re-reading KLineDataService.ts... 
        // `fetchRange(..., startTime)` is used in `backgroundSync` "fetch recent" -> `fetchRange(..., lastTime + 1)`.
        // This implies fetching NEWER data from a point.
        // OKX `after` moves backwards. `before` moves forwards.
        // So if startTime is present, we might want to use `before = startTime`? NO, `before` = ID of result.

        // OKX API is annoying for "fetch forward from 2018".
        // It's designed to fetch backward from NOW.
        // To fetch forward, we have to start from END (which we don't know) or use `before` if we have a cursor?

        // CORRECTION: OKX `before` means "request data newer than this ID". For candles, ID is timestamp.
        // So if `before = startTime`, we get candles with ts > startTime.
        // If we want >= startTime, it's close enough.

        if (startTime) {
            // Requesting data NEWER than startTime.
            // OKX `before`: If we pass a timestamp, does it work? Docs say "request candles newer than this timestamp".
            params.before = startTime.toString();
        } else if (endTime) {
            // Requesting data OLDER than endTime
            params.after = endTime.toString();
        }

        const data = await this.makeRequest<any[][]>('GET', endpoint, params);

        // OKX Data is [ts, o, h, l, c, vol, ...]. 
        // Binance Data is [ts, o, h, l, c, vol, ...] similarly (first 6 same meaning, just check format).
        // Need to ensure shape matches what KLineDataService expects.
        // KLineDataService maps: [parseInt(ts), parseFloat(o), ...]
        // OKX returns strings. So it matches structure.

        // Format check: OKX `ts` is string.
        // Binance `ts` is number? `KLineDataService.mapCandles` uses `parseInt(c.ts)`. 
        // So it expects an object with `.ts` or array?
        // Wait, `KLineDataService` mapCandles uses `c.ts`, `c.o`... this implies `c` is an OBJECT, not array!
        // BinanceApiClient returns OBJECTS?
        // Validating KLineDataService: `raw.map(c => [parseInt(c.ts), ...])`
        // Standard Binance API returns ARRAYS `[1600000, "12.1", ...]`.
        // If `BinanceApiClient` returns raw arrays, `c.ts` would be undefined.
        // `KLineDataService` line 280: `parseInt(c.ts)`.
        // This means `BinanceApiClient.getCandles` MUST be returning Objects, not raw arrays.
        // I need to check `BinanceApiClient.getCandles`.

        return data.map(d => ({
            ts: d[0],
            o: d[1],
            h: d[2],
            l: d[3],
            c: d[4],
            vol: d[5]
        } as Candle));
    }
}
