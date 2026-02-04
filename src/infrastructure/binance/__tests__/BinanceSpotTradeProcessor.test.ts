import { describe, it, expect, vi } from 'vitest';
import { BinanceSpotTradeProcessor } from '../BinanceSpotTradeProcessor';
import { BinanceApiClient } from '../BinanceApiClient';
import { RawFill } from '../../../models/types';

vi.mock('../BinanceApiClient', () => {
    const BinanceApiClient = vi.fn();
    return { BinanceApiClient };
});

describe('BinanceSpotTradeProcessor', () => {
    it('should calculate PnL for Spot buy/sell cycles', async () => {
        const mockApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceSpotTradeProcessor(mockApiClient);

        const rawFills: RawFill[] = [
            // Buy 1 BTC @ 20000
            { "instId": "BTCUSDT", "tradeId": "1", "side": "buy", "fillPx": "20000", "fillSz": "1", "fee": "1", "ts": "1000", "posSide": "", "feeCcy": "USDT", "ordId": "1", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0" },
            // Sell 0.5 BTC @ 21000. PnL = (21000 - 20000) * 0.5 = 500
            { "instId": "BTCUSDT", "tradeId": "2", "side": "sell", "fillPx": "21000", "fillSz": "0.5", "fee": "1", "ts": "2000", "posSide": "", "feeCcy": "USDT", "ordId": "2", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0" },
            // Sell 0.5 BTC @ 19000. PnL = (19000 - 20000) * 0.5 = -500
            { "instId": "BTCUSDT", "tradeId": "3", "side": "sell", "fillPx": "19000", "fillSz": "0.5", "fee": "1", "ts": "3000", "posSide": "", "feeCcy": "USDT", "ordId": "3", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0" },
        ];

        const trades = await processor.processAllData(rawFills, [], [] as any, []);

        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.totalSize).toBe(1);
        expect(trade.averageEntryPrice).toBe(20000);
        // Total PnL = 500 - 500 = 0.
        expect(trade.realizedPnl).toBe(0);
        expect(trade.status).toBe('closed');
    });
});
