import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceMarginTradeProcessor } from '../BinanceMarginTradeProcessor';
import { BinanceApiClient } from '../BinanceApiClient';
import { RawFill } from '../../../models/types';

vi.mock('../BinanceApiClient', () => {
    const BinanceApiClient = vi.fn();
    return { BinanceApiClient };
});

describe('BinanceMarginTradeProcessor', () => {
    let processor: BinanceMarginTradeProcessor;
    let mockApiClient: BinanceApiClient;

    beforeEach(() => {
        mockApiClient = new BinanceApiClient({} as any, {} as any);
        processor = new BinanceMarginTradeProcessor(mockApiClient);
    });

    it('should handle Long cycle (Buy -> Sell)', async () => {
        const rawFills: RawFill[] = [
            // Buy 1 @ 100
            { "instId": "BTCUSDT", "tradeId": "1", "side": "buy", "fillPx": "100", "fillSz": "1", "fee": "1", "ts": "1000", "feeCcy": "USDT", "ordId": "1", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
            // Sell 1 @ 150
            { "instId": "BTCUSDT", "tradeId": "2", "side": "sell", "fillPx": "150", "fillSz": "1", "fee": "1", "ts": "2000", "feeCcy": "USDT", "ordId": "2", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
        ];

        const trades = await processor.processAllData(rawFills, [], [] as any, []);
        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.direction).toBe('long');
        expect(trade.realizedPnl).toBe((150 - 100) * 1); // 50
        expect(trade.status).toBe('closed');
    });

    it('should handle Short cycle (Sell -> Buy)', async () => {
        const rawFills: RawFill[] = [
            // Sell 1 @ 150 (Open Short)
            { "instId": "BTCUSDT", "tradeId": "1", "side": "sell", "fillPx": "150", "fillSz": "1", "fee": "1", "ts": "1000", "feeCcy": "USDT", "ordId": "1", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
            // Buy 1 @ 100 (Close Short)
            { "instId": "BTCUSDT", "tradeId": "2", "side": "buy", "fillPx": "100", "fillSz": "1", "fee": "1", "ts": "2000", "feeCcy": "USDT", "ordId": "2", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
        ];

        const trades = await processor.processAllData(rawFills, [], [] as any, []);
        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.direction).toBe('short');
        // PnL = (Entry - Exit) * Size = (150 - 100) * 1 = 50
        expect(trade.realizedPnl).toBe(50);
        expect(trade.status).toBe('closed');
    });

    it('should handle Flip (Long -> Short)', async () => {
        const rawFills: RawFill[] = [
            // Buy 1 @ 100 (Open Long)
            { "instId": "BTCUSDT", "tradeId": "1", "side": "buy", "fillPx": "100", "fillSz": "1", "fee": "1", "ts": "1000", "feeCcy": "USDT", "ordId": "1", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
            // Sell 2 @ 150 (Close Long, Open Short 1)
            { "instId": "BTCUSDT", "tradeId": "2", "side": "sell", "fillPx": "150", "fillSz": "2", "fee": "1", "ts": "2000", "feeCcy": "USDT", "ordId": "2", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
        ];

        const trades = await processor.processAllData(rawFills, [], [] as any, []);
        expect(trades).toHaveLength(2); // Should be split into 2 trades

        // 1st Trade: Long Closed
        const trade1 = trades.find(t => t.direction === 'long');
        expect(trade1).toBeDefined();
        expect(trade1!.status).toBe('closed');
        expect(trade1!.realizedPnl).toBe((150 - 100) * 1); // 50

        // 2nd Trade: Short Open
        const trade2 = trades.find(t => t.direction === 'short');
        expect(trade2).toBeDefined();
        expect(trade2!.status).toBe('open');
        expect(trade2!.totalSize).toBe(1); // Remaining 1
        expect(trade2!.averageEntryPrice).toBe(150);
    });

    it('should handle Flip (Short -> Long)', async () => {
        const rawFills: RawFill[] = [
            // Sell 1 @ 150 (Open Short)
            { "instId": "BTCUSDT", "tradeId": "1", "side": "sell", "fillPx": "150", "fillSz": "1", "fee": "1", "ts": "1000", "feeCcy": "USDT", "ordId": "1", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
            // Buy 2 @ 100 (Close Short, Open Long 1)
            { "instId": "BTCUSDT", "tradeId": "2", "side": "buy", "fillPx": "100", "fillSz": "2", "fee": "1", "ts": "2000", "feeCcy": "USDT", "ordId": "2", mgnMode: "", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "", part: "0", origTradeId: "0", posSide: "" },
        ];

        const trades = await processor.processAllData(rawFills, [], [] as any, []);
        expect(trades).toHaveLength(2);

        // 1st Trade: Short Closed
        const trade1 = trades.find(t => t.direction === 'short');
        expect(trade1!.status).toBe('closed');
        expect(trade1!.realizedPnl).toBe((150 - 100) * 1); // 50

        // 2nd Trade: Long Open
        const trade2 = trades.find(t => t.direction === 'long');
        expect(trade2!.status).toBe('open');
        expect(trade2!.totalSize).toBe(1);
        expect(trade2!.averageEntryPrice).toBe(100);
    });
});
