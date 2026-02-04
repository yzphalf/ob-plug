import { BinanceApiClient } from './BinanceApiClient';
import { RawFill, Bill, InstrumentDetail, RawPositionRisk, StandardizedTrade, TradeDirection, PositionStatus, TimelineEvent } from '../../models/types';

const FLOATING_POINT_TOLERANCE = 1e-9;

/**
 * 现货交易数据处理器 (Spot Trade Processor)
 *
 * 核心职责：处理现货 (Spot) 交易数据。
 *
 * 业务逻辑：
 * 1. 现货交易本质上没有“持仓”概念，只有“买入”和“卖出”。
 * 2. 为了计算盈亏 (PnL)，我们在逻辑层模拟了“虚拟持仓” (Virtual Position)：
 *    - 买入 (Buy) = 开仓 (Open) / 加仓 (Add)。
 *    - 卖出 (Sell) = 减仓 (Reduce) / 平仓 (Close)。
 * 3. 成本计算采用 **加权平均法 (Weighted Average Cost)**。
 * 4. 盈亏计算：每次卖出时，根据 `(卖出价 - 当前持仓均价) * 卖出数量` 计算已实现盈亏。
 *
 * 特性：
 * - 币种：以计价货币 (Quote Asset, 如 USDT) 结算。
 * - 方向：默认视为做多 (Long Only)。
 */
export class BinanceSpotTradeProcessor {
    private instruments: Map<string, InstrumentDetail>;
    private binanceApiClient: BinanceApiClient;

    constructor(binanceApiClient: BinanceApiClient) {
        this.instruments = new Map<string, InstrumentDetail>();
        this.binanceApiClient = binanceApiClient;
    }

    /**
     * 处理所有数据。
     * 对于现货，我们需要模拟持仓来计算 PnL。
     * 逻辑：
     * 1. 假设所有交易都是 Long 方向 (买入=开仓/加仓, 卖出=减仓/平仓).
     * 2. 按照时间顺序处理 Fills.
     * 3. 维护一个 "Virtual Position".
     * 4. 计算加权平均买入价 (Avg Entry Price).
     * 5. 卖出时根据 (Sell Price - Avg Entry Price) 计算 Realized PnL.
     */
    public async processAllData(
        rawFills: RawFill[],
        rawBills: Bill[],
        instrumentDetails: InstrumentDetail[],
        rawPositionRisks: RawPositionRisk[]
    ): Promise<StandardizedTrade[]> {
        this.instruments.clear();
        instrumentDetails.forEach(inst => this.instruments.set(inst.instId, inst));

        // Sort by time ascending to simulate playback
        rawFills.sort((a, b) => parseInt(a.ts) - parseInt(b.ts));

        const { closedTrades, openPositions } = this._processFillsAndAggregateTrades(rawFills);

        // No funding fees in Spot usually, but we keep the structure just in case or for consistency
        const allTrades = [...closedTrades, ...Array.from(openPositions.values())];

        // Finalize metrics (Net PnL etc)
        this._finalizeTradeMetrics(allTrades);

        return allTrades;
    }

    private _processFillsAndAggregateTrades(rawFills: RawFill[]): { closedTrades: StandardizedTrade[], openPositions: Map<string, StandardizedTrade> } {
        const openPositions = new Map<string, StandardizedTrade>();
        const closedTrades: StandardizedTrade[] = [];

        for (const fill of rawFills) {
            // In Spot, 'posSide' might be empty. Key is usually just the symbol.
            // We treat everything as "LONG" cycle.
            const positionKey = `${fill.instId}-spot`;
            let trade = openPositions.get(positionKey);

            const isBuy = fill.side.toLowerCase() === 'buy';

            // If no active trade/position, and it's a BUY, we start a new Trade Cycle.
            // If it's a SELL but no position, it might be selling old inventory (pre-plugin history).
            // For now, we ignore orphan Sells or create a transient trade with 0 PnL?
            // User requested PnL calculation, assuming he has "no positions now", implies complete cycles in history.
            // Let's create a trade on BUY.

            if (!trade && !isBuy) {
                // Orphan Sell. Skip or log?
                // For safety/completeness, maybe skip.
                continue;
            }

            if (!trade) {
                trade = this._createNewTrade(fill);
                openPositions.set(positionKey, trade);
            }

            this._updateTradeWithFill(trade, fill);

            // Close condition: Position Size reaches ~0
            if (trade._currentPositionSize <= FLOATING_POINT_TOLERANCE && (trade.timeline[trade.timeline.length - 1].action === 'REDUCE' || trade.timeline[trade.timeline.length - 1].action === 'CLOSE')) {
                this._closeTrade(trade, parseInt(fill.ts));
                closedTrades.push(trade);
                openPositions.delete(positionKey);
            }
        }
        return { closedTrades, openPositions };
    }

    private _createNewTrade(fill: RawFill): StandardizedTrade {
        const fillTimestamp = parseInt(fill.ts);
        const instrument = this.instruments.get(fill.instId);
        const quoteCcy = instrument ? instrument.quoteCcy : 'USDT';
        const feeCcy = fill.feeCcy; // Initial guess

        return {
            id: `${fill.instId}-spot-${fillTimestamp}`,
            symbol: fill.instId,
            direction: TradeDirection.LONG, // Spot is essentially Long
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
            tags: ['spot'],
            _currentPositionSize: 0,
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

    private _updateTradeWithFill(trade: StandardizedTrade, fill: RawFill): void {
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

        if (isBuy) {
            // OPEN / ADD
            timelineEvent.action = trade.timeline.length > 0 ? 'ADD' : 'OPEN';

            const newCumulativeSize = trade.totalSize + fillSize;
            const newCumulativeCost = (trade.totalSize * trade.averageEntryPrice) + (fillSize * fillPrice);

            trade.averageEntryPrice = newCumulativeCost / newCumulativeSize;
            trade.totalSize = newCumulativeSize; // Tracking cumulative volume
            trade.totalValue = newCumulativeCost;

            trade._currentPositionSize += fillSize;
        } else {
            // REDUCE / CLOSE
            timelineEvent.action = 'REDUCE';
            const sizeReduced = Math.min(fillSize, trade._currentPositionSize);

            // PnL = (Exit Price - Avg Entry Price) * Size
            const pnl = (fillPrice - trade.averageEntryPrice) * sizeReduced;

            trade.realizedPnl += pnl;
            trade._currentPositionSize -= sizeReduced;

            trade._closingSizeAccumulator += sizeReduced;
            trade._closingValueAccumulator += (sizeReduced * fillPrice);

            if (trade._currentPositionSize <= FLOATING_POINT_TOLERANCE) {
                timelineEvent.action = 'CLOSE';
                trade._currentPositionSize = 0;
            }
        }

        trade.totalCommission += timelineEvent.fee; // Note: Fee might be in Base Asset (deducted from received) or Quote.
        // Complex logic: If fee is in Base Asset, it effectively reduces the received amount, changing the effective price.
        // For simplicity V1, we just record the fee separately and let Net PnL handle it (assuming fee value can be normalized or user understands).

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
            // Aggregate timeline events before finalizing metrics
            trade.timeline = this._aggregateTimelineEvents(trade.timeline);

            // Net PnL = Realized - Commission.
            // Assumption: Commission is in same currency as PnL (Quote Asset). 
            // In Spot, if you Buy BTC with USDT, fee is often in BTC (deducted).
            // If you Sell BTC for USDT, fee is in USDT.
            // For rigorous accounting, we need to convert fees. For now, we subtract raw values if they match currency, 
            // or just display them. The UI shows "Trading Fee" separately.

            trade.netPnl = trade.realizedPnl - trade.totalCommission;

            // ROI calculation
            if (trade.totalValue > 0) {
                trade.pnlPercentage = trade.netPnl / trade.totalValue;
            } else {
                trade.pnlPercentage = 0;
            }
        });
    }

    /**
     * Aggregates timeline events.
     */
    private _aggregateTimelineEvents(timeline: TimelineEvent[]): TimelineEvent[] {
        if (timeline.length < 2) return timeline;

        const aggregated: TimelineEvent[] = [];
        let currentGroup: TimelineEvent[] = [timeline[0]];

        for (let i = 1; i < timeline.length; i++) {
            const prev = currentGroup[currentGroup.length - 1];
            const current = timeline[i];
            const timeDiff = current.timestamp - prev.timestamp;

            const isSameAction = current.action === prev.action;
            // For spot, REUCE+CLOSE sequence logic is same
            const isCloseSequence = (prev.action === 'REDUCE' && current.action === 'CLOSE') || (prev.action === 'CLOSE' && current.action === 'REDUCE');
            const canMergeAction = isSameAction || isCloseSequence;

            if (canMergeAction && timeDiff < 60000) {
                currentGroup.push(current);
            } else {
                aggregated.push(this._mergeEvents(currentGroup));
                currentGroup = [current];
            }
        }

        if (currentGroup.length > 0) {
            aggregated.push(this._mergeEvents(currentGroup));
        }

        return aggregated;
    }

    private _mergeEvents(events: TimelineEvent[]): TimelineEvent {
        if (events.length === 1) return events[0];

        const first = events[0];

        let totalVal = 0;
        let totalSz = 0;
        let totalFee = 0;

        events.forEach(e => {
            totalVal += e.price * e.size;
            totalSz += e.size;
            totalFee += e.fee;
        });

        const avgPrice = totalSz > 0 ? totalVal / totalSz : 0;

        let mergedAction = first.action;
        if (events.some(e => e.action === 'CLOSE')) mergedAction = 'CLOSE';
        else if (events.some(e => e.action === 'OPEN')) mergedAction = 'OPEN';

        return {
            ...first,
            timestamp: first.timestamp,
            price: avgPrice,
            size: totalSz,
            fee: totalFee,
            action: mergedAction,
            notes: events.map(e => e.notes).filter(n => n).join('; ') || undefined
        };
    }
}
