/**
 * Binance API 客户端 (Binance Api Client)
 *
 * 这是一个底层的网络请求层。它不知道什么是“笔记”或“Obsidian”，它只懂怎么跟币安（Binance）服务器说话。
 *
 * 主要职责：
 * 1. 封装 HTTP 请求：使用 Obsidian 的 `requestUrl` 发送网络请求。
 * 2. 处理代理：将请求转发到用户配置的 Proxy URL，以解决网络访问问题。
 * 3. 定义接口：提供了 `getFillsHistory`（成交记录）、`getCandles`（K线数据）、`getPositionsRisk`（持仓风险）等原始 API 的封装。
 * 4. 错误处理：处理 HTTP 错误码和网络异常。
 */
// import { requestUrl, RequestUrlParam } from 'obsidian'; // This will be injected
import { RawOrder, RawFill, Bill, Candle, InstrumentDetail, RawPositionRisk } from '../../models/types';
import { ApiClient } from '../../models/adapter.interface';

// Define the shape of the requestUrl function and its parameters
type RequestUrlFunc = (request: any) => Promise<any>;

export class BinanceApiClient implements ApiClient {
    private proxyUrl: string;
    private requestUrl: RequestUrlFunc;

    constructor(proxyUrl: string, requestUrl: RequestUrlFunc) {
        this.proxyUrl = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl;
        this.requestUrl = requestUrl;
    }

    private async makeRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
        const queryString = new URLSearchParams(params).toString();
        const requestUrlString = `${this.proxyUrl}${endpoint}?${queryString}`;
        console.log(`Fetching from: ${requestUrlString}`);

        const requestParams = {
            url: requestUrlString,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        };

        try {
            const response = await this.requestUrl(requestParams);
            if (response.status >= 400) {
                const errorData = response.json || { msg: `HTTP Error ${response.status}` };
                throw new Error(`Binance API request failed: ${errorData.msg}`);
            }

            const jsonResponse = response.json;
            return jsonResponse as T;
        } catch (error) {
            console.error(`Failed to fetch from ${endpoint}:`, error);
            throw error;
        }
    }
    async getPositionsRisk(): Promise<RawPositionRisk[]> {
        return this.makeRequest<RawPositionRisk[]>('/fapi/v2/positionRisk');
    }

    async getCandles(instId: string, bar: string, after?: number, before?: number, limit?: number): Promise<Candle[]> {
        const params: Record<string, string> = {
            symbol: instId,
            interval: bar,
        };
        if (after) {
            params.startTime = after.toString();
        }
        if (before) {
            params.endTime = before.toString();
        }
        if (limit) {
            params.limit = limit.toString();
        }

        const candles = await this.makeRequest<any[][]>('/fapi/v1/klines', params);
        return candles.map(c => ({
            ts: c[0].toString(),
            o: c[1].toString(),
            h: c[2].toString(),
            l: c[3].toString(),
            c: c[4].toString(),
            vol: c[5].toString()
        }));
    }
    async getSymbols(instType: string): Promise<string[]> {
        const response = await this.makeRequest<any>('/fapi/v1/exchangeInfo');
        return response.symbols.map((s: any) => s.symbol);
    }

    async getAllInstruments(instType: string): Promise<InstrumentDetail[]> {
        const response = await this.makeRequest<any>('/fapi/v1/exchangeInfo');
        return response.symbols.map((symbolInfo: any) => this.mapSymbolToInstrument(symbolInfo)).filter((i: InstrumentDetail | null) => i !== null) as InstrumentDetail[];
    }

    async getInstrument(instType: string, instId: string): Promise<InstrumentDetail> {
        // Fallback to fetch all and find, or optimization? 
        // For backward compatibility or specific single use, we can keep fetching, but it's inefficient.
        // Better to encourage getAllInstruments.
        const response = await this.makeRequest<any>('/fapi/v1/exchangeInfo');
        const symbolInfo = response.symbols.find((s: any) => s.symbol === instId);
        if (symbolInfo) {
            const instrument = this.mapSymbolToInstrument(symbolInfo);
            if (instrument) return instrument;
        }
        throw new Error(`Instrument not found or invalid data for: ${instId}`);
    }

    private mapSymbolToInstrument(symbolInfo: any): InstrumentDetail | null {
        let contractSize = symbolInfo.contractSize;
        if (contractSize === undefined && symbolInfo.marginAsset === 'USDT') {
            // For USDT-margined perpetuals, contract size is implicitly 1 unit of the base asset.
            contractSize = '1';
        }

        if (contractSize === undefined) {
            // console.warn(`Could not determine 'contractSize' for symbol ${symbolInfo.symbol}.`);
            return null;
        }

        return {
            instId: symbolInfo.symbol,
            ctVal: contractSize.toString(),
            ctMult: contractSize.toString(),
            ctType: symbolInfo.contractType,
            baseCcy: symbolInfo.baseAsset,
            quoteCcy: symbolInfo.quoteAsset,
        };
    }

    async getOrdersHistory(instType: string, instId?: string, begin?: number, end?: number, limit?: number): Promise<RawOrder[]> {
        const params: Record<string, string> = {};
        if (instId) {
            params.symbol = instId;
        }
        if (begin) {
            params.startTime = begin.toString();
        }
        if (end) {
            params.endTime = end.toString();
        }
        if (limit) {
            params.limit = limit.toString();
        }
        // TODO: The 'true' argument was removed. It might have been for signed requests.
        const orders = await this.makeRequest<any[]>('/fapi/v1/allOrders', params);
        return orders.map(o => ({
            ordId: o.orderId.toString(),
            state: o.status,
            instId: o.symbol,
            uTime: o.updateTime.toString(),
            cTime: o.time.toString(),
            side: o.side.toLowerCase(),
            posSide: o.positionSide.toLowerCase(),
            ordType: o.type.toLowerCase(),
            reduceOnly: o.reduceOnly,
            avgPx: o.avgPrice,
            accFillSz: o.executedQty,
            fee: '0', // Binance order history does not include fee, would need to get from trades
            feeCcy: '', // Same as above
            lever: '0', // Not directly available in order history
            category: '', // Not available
            slTriggerPx: o.stopPrice,
            tpTriggerPx: '0', // Not available
        } as RawOrder));
    }

    async getFillsHistory(instType: string, instId?: string, begin?: number, end?: number, limit?: number): Promise<RawFill[]> {
        const params: Record<string, string> = {};
        if (instId) {
            params.symbol = instId;
        }
        if (begin) {
            params.startTime = begin.toString();
        }
        if (end) {
            params.endTime = end.toString();
        }
        if (limit) {
            params.limit = limit.toString();
        }
        // TODO: The 'true' argument was removed. It might have been for signed requests.
        const fills = await this.makeRequest<any[]>('/fapi/v1/userTrades', params);
        return fills.map(f => ({
            instId: f.symbol,
            tradeId: f.id.toString(),
            ordId: f.orderId.toString(),
            side: f.side.toLowerCase(),
            fillPx: f.price,
            fillSz: f.qty,
            fee: f.commission,
            ts: f.time.toString(),
            posSide: f.positionSide.toLowerCase(),
            mgnMode: '', // Not available
            ccy: '', // Not available
            reduceOnly: f.maker, // Maker is the closest concept, but not the same
            execType: '', // Not available
            feeCcy: f.commissionAsset,
            subType: '', // Not available
            part: '', // Not available
            origTradeId: '', // Not available
        } as RawFill));
    }

    async getBillsHistory(instType?: string, type?: string, begin?: number, end?: number, limit?: number): Promise<Bill[]> {
        const params: Record<string, string> = {};
        if (instType) {
            // Not directly supported by Binance income history, would need to filter by symbol on our end
        }
        if (type) {
            params.incomeType = type;
        }
        if (begin) {
            params.startTime = begin.toString();
        }
        if (end) {
            params.endTime = end.toString();
        }
        if (limit) {
            params.limit = limit.toString();
        }
        // TODO: The 'true' argument was removed. It might have been for signed requests.
        const bills = await this.makeRequest<any[]>('/fapi/v1/income', params);
        return bills.map(b => ({
            instId: b.symbol || '',
            ccy: b.asset,
            balChg: b.income,
            ts: b.time.toString(),
            type: b.incomeType,
        }));
    }

    async getTickerPrice(symbol: string): Promise<number> {
        const params = { symbol };
        const response = await this.makeRequest<any>('/fapi/v1/ticker/price', params);
        return parseFloat(response.price);
    }
}
