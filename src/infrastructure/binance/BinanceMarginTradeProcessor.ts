import { BinanceApiClient } from './BinanceApiClient';
import { RawFill, Bill, InstrumentDetail, RawPositionRisk, StandardizedTrade, TradeDirection, PositionStatus, TimelineEvent } from '../../models/types';

const FLOATING_POINT_TOLERANCE = 1e-9;

/**
 * 杠杆交易数据处理器 (Margin Trade Processor)
 *
 * 核心职责：处理杠杆账户 (Cross/Isolated Margin) 的交易数据。
 *
 * 业务逻辑：
 * 1. 杠杆交易本质上是“借贷 + 现货”。
 * 2. 与纯现货不同，杠杆可以 **做空 (Short)**。
 * 3. 我们不需要关心具体的“借还款”操作，只需要关注 **净持仓 (Net Position)** 的变化：
 *    - 维护一个 **带符号的持仓量 (Signed Position Size)**。
 *    - 正数 (+) 代表看多 (Long Position) —— 买入持有。
 *    - 负数 (-) 代表看空 (Short Position) —— 借币卖出。
 *
 * 核心算法 (Bidirectional signed position):
 * - **Buy**: Position + Qty.
 * - **Sell**: Position - Qty.
 * - **Flip**: 如果一次交易导致 Position 符号改变 (例如从 -5 变成 +3)，说明是“平空单”并“反手开多”。
 *   这时需要拆分成两笔交易处理：平仓 5 个 + 开仓 3 个。
 *
 * 特性：
 * - 币种：以计价货币 (Quote Asset, 如 USDT) 结算盈亏。
 * - 成本：Long 使用加权平均买入价；Short 使用加权平均卖出价。
 */
export class BinanceMarginTradeProcessor {
    private instruments: Map<string, InstrumentDetail>;
    private binanceApiClient: BinanceApiClient;

    constructor(binanceApiClient: BinanceApiClient) {
        this.instruments = new Map<string, InstrumentDetail>();
        this.binanceApiClient = binanceApiClient;
    }

    public async processAllData(
        rawFills: RawFill[],
        rawBills: Bill[],
        instrumentDetails: InstrumentDetail[],
        rawPositionRisks: RawPositionRisk[]
    ): Promise<StandardizedTrade[]> {
        this.instruments.clear();
        instrumentDetails.forEach(inst => this.instruments.set(inst.instId, inst));

        rawFills.sort((a, b) => parseInt(a.ts) - parseInt(b.ts)); // Time ASC

        const { closedTrades, openPositions } = this._processFillsAndAggregateTrades(rawFills);
        const allTrades = [...closedTrades, ...Array.from(openPositions.values())];

        this._finalizeTradeMetrics(allTrades);

        return allTrades;
    }

    private _processFillsAndAggregateTrades(rawFills: RawFill[]): { closedTrades: StandardizedTrade[], openPositions: Map<string, StandardizedTrade> } {
        const openPositions = new Map<string, StandardizedTrade>(); // Key: symbol-margin
        const closedTrades: StandardizedTrade[] = [];

        for (const fill of rawFills) {
            const positionKey = `${fill.instId}-margin`;
            let trade = openPositions.get(positionKey);

            if (!trade) {
                // If no existing trade, create one based on direction
                // Buy -> Open LONG
                // Sell -> Open SHORT
                trade = this._createNewTrade(fill);
                openPositions.set(positionKey, trade);
                this._updateTradeWithFill(trade, fill);
            } else {
                // Check for FLIP (Reversal)
                // Current Size > 0 (Long) && Sell > Size? -> Flip to Short
                // Current Size < 0 (Short) && Buy > |Size|? -> Flip to Long

                const fillSize = parseFloat(fill.fillSz);
                const isBuy = fill.side.toLowerCase() === 'buy';

                let isFlip = false;
                let closingSize = 0;
                let openingSize = 0;

                if (trade.direction === TradeDirection.LONG && !isBuy) {
                    // Holding Long, Selling
                    if (fillSize > trade._currentPositionSize + FLOATING_POINT_TOLERANCE) {
                        isFlip = true;
                        closingSize = trade._currentPositionSize;
                        openingSize = fillSize - closingSize;
                    }
                } else if (trade.direction === TradeDirection.SHORT && isBuy) {
                    // Holding Short, Buying
                    if (fillSize > Math.abs(trade._currentPositionSize) + FLOATING_POINT_TOLERANCE) {
                        isFlip = true;
                        closingSize = Math.abs(trade._currentPositionSize);
                        openingSize = fillSize - closingSize;
                    }
                }

                if (isFlip) {
                    // 1. Close current trade completely
                    // We must clone the fill and modify size to exact closing size
                    const closingFill = { ...fill, fillSz: closingSize.toString() };
                    this._updateTradeWithFill(trade, closingFill);
                    this._closeTrade(trade, parseInt(fill.ts));
                    closedTrades.push(trade);

                    // 2. Open new trade with remaining size
                    const openingFill = { ...fill, fillSz: openingSize.toString() };
                    const newTrade = this._createNewTrade(openingFill);
                    // The _createNewTrade will set direction based on fill side
                    // If we were Long and Selling, now we are Shorting. (Sell -> Open Short)
                    // If we were Short and Buying, now we are Longing. (Buy -> Open Long)
                    this._updateTradeWithFill(newTrade, openingFill, true); // true = force update even if size logic inside matches
                    openPositions.set(positionKey, newTrade);

                } else {
                    // Normal update (Add or Reduce)
                    this._updateTradeWithFill(trade, fill);

                    // Check close
                    if (Math.abs(trade._currentPositionSize) <= FLOATING_POINT_TOLERANCE &&
                        (trade.timeline[trade.timeline.length - 1].action === 'REDUCE' || trade.timeline[trade.timeline.length - 1].action === 'CLOSE')
                    ) {
                        this._closeTrade(trade, parseInt(fill.ts));
                        closedTrades.push(trade);
                        openPositions.delete(positionKey);
                    }
                }
            }
        }
        return { closedTrades, openPositions };
    }

    private _createNewTrade(fill: RawFill): StandardizedTrade {
        const fillTimestamp = parseInt(fill.ts);
        const instrument = this.instruments.get(fill.instId);
        const quoteCcy = instrument ? instrument.quoteCcy : 'USDT';
        const feeCcy = fill.feeCcy;

        // Initial direction: Buy -> Long, Sell -> Short
        const isBuy = fill.side.toLowerCase() === 'buy';
        const direction = isBuy ? TradeDirection.LONG : TradeDirection.SHORT;

        return {
            id: `${fill.instId}-margin-${fillTimestamp}`,
            symbol: fill.instId,
            direction: direction,
            status: PositionStatus.OPEN,
            entryTime: fillTimestamp,
            exitTime: 0,
            durationMs: 0,
            totalSize: 0,
            totalValue: 0,
            averageEntryPrice: 0,
            averageExitPrice: 0,
            realizedPnl: 0,
            totalCommission: 0,
            totalFundingFee: 0,
            netPnl: 0,
            pnlPercentage: 0,
            timeline: [],
            tradeIds: [],
            orderIds: [],
            notes: '',
            tags: ['margin'],
            _currentPositionSize: 0, // Signed. + for Long, - for Short
            _closingSizeAccumulator: 0,
            _closingValueAccumulator: 0,
            _rawFills: [],
            _rawBills: [],
            currentNotionalValue: undefined,
            pnlCurrency: quoteCcy,
            feeCurrency: feeCcy,
            valueCurrency: quoteCcy
        };
    }

    private _updateTradeWithFill(trade: StandardizedTrade, fill: RawFill, isOpeningNewCycle: boolean = false): void {
        const isBuy = fill.side.toLowerCase() === 'buy';
        const fillPrice = parseFloat(fill.fillPx);
        const fillSize = parseFloat(fill.fillSz);

        const timelineEvent: TimelineEvent = {
            timestamp: parseInt(fill.ts),
            action: 'UNKNOWN' as any,
            size: fillSize,
            price: fillPrice,
            notes: undefined,
            tradeId: fill.tradeId,
            orderId: fill.ordId,
            fee: parseFloat(fill.fee || '0'),
            feeCcy: fill.feeCcy
        };

        // Determine if this fill is Increasing (OPEN/ADD) or Decreasing (REDUCE/CLOSE) the position
        let isIncrease = false;

        if (trade.direction === TradeDirection.LONG) {
            isIncrease = isBuy; // Buying increases Long
        } else {
            isIncrease = !isBuy; // Selling increases Short
        }

        if (isIncrease) {
            // OPEN / ADD
            timelineEvent.action = (Math.abs(trade._currentPositionSize) > 0 && !isOpeningNewCycle) ? 'ADD' : 'OPEN';

            // Update Weighted Average Entry Price
            // For Short: Average Sell Price
            const currentAbsSize = Math.abs(trade._currentPositionSize);
            const currentCost = currentAbsSize * trade.averageEntryPrice;
            const newFillCost = fillSize * fillPrice;

            const newTotalSize = currentAbsSize + fillSize;
            trade.averageEntryPrice = (currentCost + newFillCost) / newTotalSize;

            trade.totalSize += fillSize; // Cumulative volume
            trade.totalValue += newFillCost;

            if (trade.direction === TradeDirection.LONG) {
                trade._currentPositionSize += fillSize;
            } else {
                trade._currentPositionSize -= fillSize;
            }

        } else {
            // REDUCE / CLOSE
            timelineEvent.action = 'REDUCE';
            // Size to reduce (should be fillSize unless error)
            const reduceSize = fillSize;

            // PnL Calculation
            // Long: (Exit - Entry) * Size
            // Short: (Entry - Exit) * Size (Shorting: Sell High, Buy Low)

            let pnl = 0;
            if (trade.direction === TradeDirection.LONG) {
                pnl = (fillPrice - trade.averageEntryPrice) * reduceSize;
                trade._currentPositionSize -= reduceSize;
            } else {
                pnl = (trade.averageEntryPrice - fillPrice) * reduceSize;
                trade._currentPositionSize += reduceSize; // Adding to negative makes it closer to 0
            }

            trade.realizedPnl += pnl;

            trade._closingSizeAccumulator += reduceSize;
            trade._closingValueAccumulator += (reduceSize * fillPrice);

            if (Math.abs(trade._currentPositionSize) <= FLOATING_POINT_TOLERANCE) {
                timelineEvent.action = 'CLOSE';
                trade._currentPositionSize = 0;
            }
        }

        trade.totalCommission += timelineEvent.fee;
        trade.timeline.push(timelineEvent);
        trade.tradeIds.push(fill.tradeId);
        trade._rawFills.push(fill);
        if (!trade.orderIds.includes(fill.ordId)) {
            trade.orderIds.push(fill.ordId);
        }
    }

    private _closeTrade(trade: StandardizedTrade, exitTimestamp: number): void {
        trade.status = PositionStatus.CLOSED;
        trade.exitTime = exitTimestamp;
        trade.durationMs = trade.exitTime - trade.entryTime;
        if (trade._closingSizeAccumulator > 0) {
            trade.averageExitPrice = trade._closingValueAccumulator / trade._closingSizeAccumulator;
        } else {
            trade.averageExitPrice = 0;
        }
    }

    private _finalizeTradeMetrics(allTrades: StandardizedTrade[]): void {
        allTrades.forEach(trade => {
            // Aggregate timeline events before finalizing metrics (though metrics don't depend on timeline, visualization does)
            trade.timeline = this._aggregateTimelineEvents(trade.timeline);

            trade.netPnl = trade.realizedPnl - trade.totalCommission;
            if (trade.totalValue > 0) {
                trade.pnlPercentage = trade.netPnl / trade.totalValue;
            } else {
                trade.pnlPercentage = 0;
            }
        });
    }

    /**
     * Aggregates timeline events that allow for cleaner visualization.
     * Rules:
     * 1. Same Action (e.g. valid checks)
     * 2. Time difference < 60s
     */
    private _aggregateTimelineEvents(timeline: TimelineEvent[]): TimelineEvent[] {
        if (timeline.length < 2) return timeline;

        const aggregated: TimelineEvent[] = [];
        let currentGroup: TimelineEvent[] = [timeline[0]];

        for (let i = 1; i < timeline.length; i++) {
            const prev = currentGroup[currentGroup.length - 1]; // Compare with last added to group? Or first of group?
            // Usually compare with the *start* of the group to define the window, or just adjacent?
            // Adjacent < 60s is safer for "streaks".

            const current = timeline[i];
            const timeDiff = current.timestamp - prev.timestamp;

            // Check if mergeable
            // Same Action is mandatory.
            // Exception: REDUCE and CLOSE should often be merged into CLOSE if they are split.
            // But if we merge REDUCE + CLOSE, the resulting action should be CLOSE.
            // If we merge OPEN + ADD, result is ADD? Or OPEN if it's at the very start?

            const isSameAction = current.action === prev.action;
            const isCloseSequence = (prev.action === 'REDUCE' && current.action === 'CLOSE') || (prev.action === 'CLOSE' && current.action === 'REDUCE'); // Latter is unlikely but possible entry order

            // Allow merging if Same Action OR it's a Reduce/Close sequence
            const canMergeAction = isSameAction || isCloseSequence;

            if (canMergeAction && timeDiff < 60000) {
                currentGroup.push(current);
            } else {
                // Finalize current group
                aggregated.push(this._mergeEvents(currentGroup));
                currentGroup = [current]; // Start new group
            }
        }

        // Push last group
        if (currentGroup.length > 0) {
            aggregated.push(this._mergeEvents(currentGroup));
        }

        return aggregated;
    }

    private _mergeEvents(events: TimelineEvent[]): TimelineEvent {
        if (events.length === 1) return events[0];

        const first = events[0];
        const last = events[events.length - 1];

        let totalVal = 0;
        let totalSz = 0;
        let totalFee = 0;

        events.forEach(e => {
            totalVal += e.price * e.size;
            totalSz += e.size;
            totalFee += e.fee;
        });

        const avgPrice = totalSz > 0 ? totalVal / totalSz : 0;

        // Determine Action: If any is CLOSE, result is CLOSE. If any is OPEN, result is OPEN?
        // Usually:
        // OPEN + ADD -> OPEN (if at start) or ADD. 
        // Let's stick to: If group contains OPEN, use OPEN. If group contains CLOSE, use CLOSE. Else use first.action.

        let mergedAction = first.action;
        if (events.some(e => e.action === 'CLOSE')) mergedAction = 'CLOSE';
        else if (events.some(e => e.action === 'OPEN')) mergedAction = 'OPEN';

        return {
            ...first, // Inherit mainly ID/TradeID from first
            timestamp: first.timestamp, // Use first timestamp
            price: avgPrice,
            size: totalSz,
            fee: totalFee,
            action: mergedAction,
            notes: events.map(e => e.notes).filter(n => n).join('; ') || undefined
        };
    }
}
