import { describe, it, expect, vi } from 'vitest';
import { BinanceCMFuturesTradeProcessor } from '../BinanceCMFuturesTradeProcessor';
import { BinanceApiClient } from '../BinanceApiClient';
import { RawFill } from '../../../models/types';

vi.mock('../BinanceApiClient', () => {
    const BinanceApiClient = vi.fn();
    return { BinanceApiClient };
});

describe('BinanceCMFuturesTradeProcessor', () => {
    it('should correctly calculate PnL for Inverse contracts', async () => {
        const mockApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceCMFuturesTradeProcessor(mockApiClient);

        // BTCUSD_PERP, 1 ct = 100 USD.
        // Buy 10 contracts at 50000 USD. Notional = 1000 USD. Cost = 1000/50000 = 0.02 BTC.
        // Sell 10 contracts at 55000 USD. Notional = 1000 USD. Cost = 1000/55000 = 0.01818... BTC.
        // PnL(Long) = Size * ctVal * (1/Entry - 1/Exit) = 10 * 100 * (1/50000 - 1/55000)
        // = 1000 * (0.00002 - 0.0000181818) = 1000 * 0.000001818... = 0.00181818... BTC. (approx)

        const rawFills: RawFill[] = [
            { "instId": "BTCUSD_PERP", "tradeId": "1", "side": "buy", "fillPx": "50000", "fillSz": "10", "fee": "0", "ts": "1000", "posSide": "long", "feeCcy": "BTC", "ordId": "1", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "BTC", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "BTCUSD_PERP", "tradeId": "2", "side": "sell", "fillPx": "55000", "fillSz": "10", "fee": "0", "ts": "2000", "posSide": "long", "feeCcy": "BTC", "ordId": "2", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "BTC", subType: "FILL", part: "0", origTradeId: "0" },
        ];

        const instrumentDetails = [
            { instId: 'BTCUSD_PERP', ctVal: '100', baseCcy: 'BTC', quoteCcy: 'USD' }
        ];

        const trades = await processor.processAllData(rawFills, [], instrumentDetails as any, []);

        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.status).toBe('closed');
        const expectedPnl = 10 * 100 * (1 / 50000 - 1 / 55000); // 0.00181818...
        expect(trade.realizedPnl).toBeCloseTo(expectedPnl, 8);
        expect(trade.pnlCurrency).toBe('BTC');
    });
});
