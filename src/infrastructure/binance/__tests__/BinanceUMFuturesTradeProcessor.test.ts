import { describe, it, expect, vi } from 'vitest';
import { BinanceUMFuturesTradeProcessor } from '../BinanceUMFuturesTradeProcessor';
import { BinanceApiClient } from '../BinanceApiClient';
import { RawFill } from '../../../models/types';

// Mock the BinanceApiClient
vi.mock('../BinanceApiClient', () => {
    const BinanceApiClient = vi.fn();
    BinanceApiClient.prototype.getFillsHistory = vi.fn();
    return { BinanceApiClient };
});

describe('BinanceUMFuturesTradeProcessor', () => {
    it('should correctly process fills into distinct trades, ignoring orphans', async () => {
        // Arrange
        const mockBinanceApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceUMFuturesTradeProcessor(mockBinanceApiClient);

        const rawFills: RawFill[] = [
            { "instId": "ETHUSDT", "tradeId": "7082893861", "side": "sell", "fillPx": "2926.30", "fillSz": "0.172", "fee": "0.25166180", "ts": "1766069352044", "posSide": "long", "feeCcy": "USDT", "ordId": "1", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "SOLUSDT", "tradeId": "3026194170", "side": "buy", "fillPx": "126.2900", "fillSz": "3.95", "fee": "0.09976910", "ts": "1766161861730", "posSide": "long", "feeCcy": "USDT", "ordId": "2", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "SOLUSDT", "tradeId": "3026290947", "side": "sell", "fillPx": "125.3100", "fillSz": "3.95", "fee": "0.24748725", "ts": "1766163864022", "posSide": "long", "feeCcy": "USDT", "ordId": "3", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "SOLUSDT", "tradeId": "3028056094", "side": "buy", "fillPx": "125.7500", "fillSz": "5.56", "fee": "0.13983400", "ts": "1766277702477", "posSide": "long", "feeCcy": "USDT", "ordId": "4", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "SOLUSDT", "tradeId": "3028169136", "side": "sell", "fillPx": "124.8300", "fillSz": "5.56", "fee": "0.13881096", "ts": "1766284653091", "posSide": "long", "feeCcy": "USDT", "ordId": "5", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7106448207", "side": "sell", "fillPx": "3040", "fillSz": "0.098", "fee": "0.05958400", "ts": "1766379546138", "posSide": "short", "feeCcy": "USDT", "ordId": "6", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7106984662", "side": "buy", "fillPx": "3047", "fillSz": "0.098", "fee": "0.05972120", "ts": "1766391761814", "posSide": "short", "feeCcy": "USDT", "ordId": "7", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7109583901", "side": "sell", "fillPx": "3030.01", "fillSz": "0.165", "fee": "0.09999033", "ts": "1766418173927", "posSide": "short", "feeCcy": "USDT", "ordId": "8", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7109703542", "side": "buy", "fillPx": "3054.39", "fillSz": "0.165", "fee": "0.25198717", "ts": "1766418966304", "posSide": "short", "feeCcy": "USDT", "ordId": "9", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7120928666", "side": "buy", "fillPx": "2928", "fillSz": "0.170", "fee": "0.09955200", "ts": "1766576106814", "posSide": "long", "feeCcy": "USDT", "ordId": "10", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "ETHUSDT", "tradeId": "7122571474", "side": "sell", "fillPx": "2941.11", "fillSz": "0.170", "fee": "0.09999774", "ts": "1766594935576", "posSide": "long", "feeCcy": "USDT", "ordId": "11", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" }
        ];

        const instrumentDetails = [
            { instId: 'ETHUSDT', ctVal: '1' },
            { instId: 'SOLUSDT', ctVal: '1' }
        ];

        // Act
        const standardizedTrades = await processor.processAllData(rawFills, [], instrumentDetails as any, []);

        // Assert
        expect(standardizedTrades).toHaveLength(5);

        const tradeIds = standardizedTrades.map(t => t.id);

        // Check that all expected trades are present
        expect(tradeIds).toContain('SOLUSDT-long-1766161861730');
        expect(tradeIds).toContain('SOLUSDT-long-1766277702477');
        expect(tradeIds).toContain('ETHUSDT-short-1766379546138');
        expect(tradeIds).toContain('ETHUSDT-short-1766418173927');
        // This is the trade that was previously being missed
        expect(tradeIds).toContain('ETHUSDT-long-1766576106814');

        // Check that the orphan trade was NOT created
        const orphanTradeId = 'ETHUSDT-long-1766069352044';
        expect(tradeIds).not.toContain(orphanTradeId);
    });

    it('should return an empty array if no fills are provided', async () => {
        // Arrange
        const mockBinanceApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceUMFuturesTradeProcessor(mockBinanceApiClient);

        // Act
        const standardizedTrades = await processor.processAllData([], [], [], []);

        // Assert
        expect(standardizedTrades).toHaveLength(0);
    });

    it('should correctly process a trade that is opened but not closed', async () => {
        // Arrange
        const mockBinanceApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceUMFuturesTradeProcessor(mockBinanceApiClient);
        const rawFills: RawFill[] = [
            { "instId": "BTCUSDT", "tradeId": "1", "side": "buy", "fillPx": "50000", "fillSz": "1", "fee": "10", "ts": "1767000000000", "posSide": "long", "feeCcy": "USDT", "ordId": "100", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
        ];
        const instrumentDetails = [{ instId: 'BTCUSDT', ctVal: '1' }];

        // Act
        const standardizedTrades = await processor.processAllData(rawFills, [], instrumentDetails as any, []);

        // Assert
        expect(standardizedTrades).toHaveLength(1);
        expect(standardizedTrades[0].status).toBe('open');
        expect(standardizedTrades[0].id).toBe('BTCUSDT-long-1767000000000');
    });

    it('should correctly sum multiple funding fees for a single trade', async () => {
        // Arrange
        const mockBinanceApiClient = new BinanceApiClient({} as any, {} as any);
        const processor = new BinanceUMFuturesTradeProcessor(mockBinanceApiClient);
        const rawFills: RawFill[] = [
            { "instId": "BTCUSDT", "tradeId": "1", "side": "buy", "fillPx": "50000", "fillSz": "1", "fee": "10", "ts": "1767000000000", "posSide": "long", "feeCcy": "USDT", "ordId": "100", mgnMode: "CROSS", reduceOnly: false, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
            { "instId": "BTCUSDT", "tradeId": "2", "side": "sell", "fillPx": "51000", "fillSz": "1", "fee": "10", "ts": "1767086400000", "posSide": "long", "feeCcy": "USDT", "ordId": "101", mgnMode: "CROSS", reduceOnly: true, execType: "TRADE", ccy: "USDT", subType: "FILL", part: "0", origTradeId: "0" },
        ];
        const rawBills = [
            { "instId": "BTCUSDT", "type": "FUNDING_FEE", "balChg": "-5.5", "ts": "1767028800000" }, // 8am
            { "instId": "BTCUSDT", "type": "FUNDING_FEE", "balChg": "-4.5", "ts": "1767057600000" }, // 4pm
            { "instId": "UNRELATED", "type": "FUNDING_FEE", "balChg": "-100", "ts": "1767057600000" },
        ];
        const instrumentDetails = [{ instId: 'BTCUSDT', ctVal: '1' }];

        // Act
        const standardizedTrades = await processor.processAllData(rawFills, rawBills as any, instrumentDetails as any, []);

        // Assert
        expect(standardizedTrades).toHaveLength(1);
        expect(standardizedTrades[0].status).toBe('closed');
        // Use toBeCloseTo for floating point comparisons
        expect(standardizedTrades[0].totalFundingFee).toBeCloseTo(-10.0);
        // Net PnL = Realized PnL - Commission + Funding Fee = (51000-50000) - (10+10) + (-10) = 1000 - 20 - 10 = 970
        expect(standardizedTrades[0].netPnl).toBeCloseTo(970);
    });
});
