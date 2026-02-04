import { describe, it, expect, vi } from 'vitest';
import { formatDuration, formatTimestamp } from '../../utils/LocalTimeUtils';
import { generateObsidianNote } from '../NoteGenerator';
import { StandardizedTrade, TradeDirection, PositionStatus } from '../../models/types';

// Mock getCurrentLanguage for consistent testing
vi.mock('../lang/translator', () => ({
    t: (str: string) => str, // Simple pass-through for 't' function
    getCurrentLanguage: () => 'en', // Always return 'en' for testing
}));


describe('note_template helper functions', () => {
    describe('formatDuration', () => {
        it('should return "0 minutes" for zero or negative duration', () => {
            expect(formatDuration(0)).toBe('0 minutes');
            expect(formatDuration(-1000)).toBe('0 minutes');
        });

        it('should format duration less than a minute correctly', () => {
            expect(formatDuration(30 * 1000)).toBe('<1 minute');
        });

        it('should format duration in minutes correctly', () => {
            expect(formatDuration(60 * 1000)).toBe('1 minute');
            expect(formatDuration(120 * 1000)).toBe('2 minutes');
            expect(formatDuration(90 * 1000)).toBe('1 minute'); // should be 1 minute 30 seconds but rounds down
        });

        it('should format duration in hours and minutes correctly', () => {
            expect(formatDuration(3600 * 1000)).toBe('1 hour');
            expect(formatDuration(3660 * 1000)).toBe('1 hour 1 minute');
            expect(formatDuration(7320 * 1000)).toBe('2 hours 2 minutes');
        });

        it('should format duration in days, hours, and minutes correctly', () => {
            expect(formatDuration(24 * 3600 * 1000)).toBe('1 day');
            expect(formatDuration(25 * 3600 * 1000)).toBe('1 day 1 hour');
            expect(formatDuration((24 * 3600 + 60) * 1000)).toBe('1 day 1 minute');
            expect(formatDuration((24 * 3600 + 3600 + 60) * 1000)).toBe('1 day 1 hour 1 minute');
        });
    });

    describe('formatTimestamp', () => {
        // Test with a known timestamp
        const testTimestamp = 1678886400000; // March 15, 2023 12:00:00 PM UTC

        it('should return "N/A" for zero or negative timestamp', () => {
            expect(formatTimestamp(0)).toBe('N/A');
            expect(formatTimestamp(-1000)).toBe('N/A');
        });

        it('should format timestamp correctly for English locale', () => {
            // Adjust expected string based on the locale and timezone where the test runner executes
            // This might be flaky if the test environment's timezone changes.
            // Assuming UTC-0 for simplicity or local timezone
            const expectedEn = new Date(testTimestamp).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            });
            expect(formatTimestamp(testTimestamp)).toBe(expectedEn);
        });

        // Note: Testing for 'zh' locale would require mocking getCurrentLanguage to return 'zh'
        // and potentially setting process.env.TZ or similar for consistent timezone,
        // which might be overly complex for a unit test if not strictly needed.
    });

    describe('generateObsidianNote', () => {
        it('should include Nominal Value in the timeline', () => {
            const mockTrade: StandardizedTrade = {
                id: 'test-trade-1',
                symbol: 'BTCUSDT',
                direction: TradeDirection.LONG,
                status: PositionStatus.CLOSED,
                entryTime: 1678886400000,
                exitTime: 1678886400000 + 60000,
                durationMs: 60000,
                totalSize: 1.5,
                totalValue: 30000,
                averageEntryPrice: 20000,
                averageExitPrice: 21000,
                realizedPnl: 1500,
                totalCommission: 5,
                totalFundingFee: 0,
                netPnl: 1495,
                pnlPercentage: 0.05,
                pnlCurrency: 'USDT',
                feeCurrency: 'USDT',
                valueCurrency: 'USDT',
                timeline: [
                    {
                        timestamp: 1678886400000,
                        action: 'OPEN',
                        size: 1.5,
                        price: 20000,
                        fee: 5,
                        feeCcy: 'USDT',
                        tradeId: 't1',
                        orderId: 'o1',
                        notes: 'Test Open'
                    }
                ],
                tradeIds: ['t1'],
                orderIds: ['o1'],
                notes: '',
                tags: [],
                _currentPositionSize: 0,
                _closingSizeAccumulator: 0,
                _closingValueAccumulator: 0,
                _rawFills: [],
                _rawBills: []
            };

            const noteContent = generateObsidianNote(mockTrade);
            // Expected nominal value: 1.5 * 20000 = 30000
            expect(noteContent).toContain('Nominal Value: 30000.00');
        });
    });
});
