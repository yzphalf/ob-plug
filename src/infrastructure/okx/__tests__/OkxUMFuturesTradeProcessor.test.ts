import { describe, it, expect, vi } from 'vitest';
import { OkxUMFuturesTradeProcessor } from '../OkxUMFuturesTradeProcessor';
import { OkxApiClient } from '../OkxApiClient';
import { OkxFill, OkxBill, OkxInstrument, OkxPosition } from '../types';
import { PositionStatus } from '../../../models/types';

// Mock the OkxApiClient
vi.mock('../OkxApiClient', () => {
    const OkxApiClient = vi.fn();
    return { OkxApiClient };
});

describe('OkxUMFuturesTradeProcessor', () => {
    it('should correctly process fills into distinct trades', async () => {
        // Arrange
        const mockApiClient = new OkxApiClient('url', {} as any);
        const processor = new OkxUMFuturesTradeProcessor(mockApiClient);

        const rawFills: OkxFill[] = [
            // Trade 1: Buy Open
            { instId: "BTC-USDT-SWAP", tradeId: "1", side: "buy", fillPx: "50000", fillSz: "1", fee: "-0.0001", ts: "1767000000000", posSide: "long", feeCcy: "BTC", ordId: "100", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },
            // Trade 1: Sell Close (Reduce Only implicit via logic)
            { instId: "BTC-USDT-SWAP", tradeId: "2", side: "sell", fillPx: "51000", fillSz: "1", fee: "-0.0001", ts: "1767086400000", posSide: "long", feeCcy: "BTC", ordId: "101", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },
        ];

        const instruments: OkxInstrument[] = [
            { instId: "BTC-USDT-SWAP", ctVal: "0.01", ctMult: "1", instType: "SWAP" } as any
        ];

        // Act
        const trades = await processor.processAllData(rawFills, [], instruments, []);

        // Assert
        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.symbol).toBe("BTC-USDT-SWAP");
        expect(trade.status).toBe(PositionStatus.CLOSED);
        expect(trade.averageEntryPrice).toBe(50000);
        expect(trade.averageExitPrice).toBe(51000);
        // PnL = (51000 - 50000) * 1 * ctVal(0.01) = 1000 * 0.01 = 10
        expect(trade.realizedPnl).toBeCloseTo(10);
    });

    it('should handle funding fees from bills', async () => {
        // Arrange
        const mockApiClient = new OkxApiClient('url', {} as any);
        const processor = new OkxUMFuturesTradeProcessor(mockApiClient);

        const rawFills: OkxFill[] = [
            { instId: "ETH-USDT-SWAP", tradeId: "10", side: "sell", fillPx: "3000", fillSz: "10", fee: "0", ts: "1767000000000", posSide: "short", feeCcy: "USDT", ordId: "200", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },
            { instId: "ETH-USDT-SWAP", tradeId: "11", side: "buy", fillPx: "2900", fillSz: "10", fee: "0", ts: "1767086400000", posSide: "short", feeCcy: "USDT", ordId: "201", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },
        ];

        // Funding Fee Bill (Type '8')
        const rawBills: OkxBill[] = [
            { instId: "ETH-USDT-SWAP", type: "8", balChg: "-5.0", ts: "1767043200000", billId: "b1", ccy: "USDT" } as any
        ];

        const instruments: OkxInstrument[] = [
            { instId: "ETH-USDT-SWAP", ctVal: "1", ctMult: "1", instType: "SWAP" } as any
        ];

        // Act
        const trades = await processor.processAllData(rawFills, rawBills, instruments, []);

        // Assert
        expect(trades).toHaveLength(1);
        const trade = trades[0];
        expect(trade.totalFundingFee).toBe(-5.0);
        // PnL = Short (3000 - 2900) * 10 = 1000. Net = 1000 + (-5) = 995
        expect(trade.netPnl).toBeCloseTo(995);
    });

    it('should ignore orphan reducing fills', async () => {
        // Arrange
        const mockApiClient = new OkxApiClient('url', {} as any);
        const processor = new OkxUMFuturesTradeProcessor(mockApiClient);

        const rawFills: OkxFill[] = [
            // Orphan Sell Long (Reduce) - Should be skipped
            { instId: "SOL-USDT-SWAP", tradeId: "99", side: "sell", fillPx: "100", fillSz: "1", fee: "0", ts: "1766000000000", posSide: "long", feeCcy: "USDT", ordId: "99", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },

            // Valid Trade
            { instId: "SOL-USDT-SWAP", tradeId: "100", side: "buy", fillPx: "100", fillSz: "1", fee: "0", ts: "1767000000000", posSide: "long", feeCcy: "USDT", ordId: "100", execType: "T", instType: "SWAP", clOrdId: "", billId: "", tag: "" },
        ];

        const instruments: OkxInstrument[] = [
            { instId: "SOL-USDT-SWAP", ctVal: "1", ctMult: "1", instType: "SWAP" } as any
        ];

        // Act
        const trades = await processor.processAllData(rawFills, [], instruments, []);

        // Assert
        expect(trades).toHaveLength(1);
        expect(trades[0].entryTime).toBe(1767000000000); // Only the valid one
    });
});
