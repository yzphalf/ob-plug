import { RawOrder, RawFill, Bill, Candle, InstrumentDetail, RawPositionRisk, StandardizedTrade } from './types';

export interface ApiClient {
    getPositionsRisk(): Promise<RawPositionRisk[]>;
    getCandles(instId: string, bar: string, after?: number, before?: number, limit?: number): Promise<Candle[]>;
    getInstrument(instType: string, instId: string): Promise<InstrumentDetail>;
    getOrdersHistory(instType: string, instId?: string, begin?: number, end?: number, limit?: number): Promise<RawOrder[]>;
    getFillsHistory(instType: string, instId?: string, begin?: number, end?: number, limit?: number): Promise<RawFill[]>;
    getBillsHistory(instType?: string, type?: string, begin?: number, end?: number, limit?: number): Promise<Bill[]>;
}

/**
 * Defines the standard interface for a data provider that returns ready-to-use, standardized data.
 * This is the primary interface the main application will interact with.
 */
export interface IDataAdapter {
    getStandardizedTrades(): Promise<StandardizedTrade[]>;
    setLastSyncTimestamp(timestamp: number): void;
    getTickerPrice(symbol: string): Promise<number>;
}
