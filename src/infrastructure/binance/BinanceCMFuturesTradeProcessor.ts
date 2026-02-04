import { BinanceApiClient } from './BinanceApiClient';
import { RawFill, Bill, InstrumentDetail, RawPositionRisk, StandardizedTrade, TradeDirection, PositionStatus, TimelineEvent } from '../../models/types';

const BILL_TYPE_FUNDING_FEE = 'FUNDING_FEE';
const FLOATING_POINT_TOLERANCE = 1e-9;

/**
 * 币本位合约数据处理器 (Coin-Margined Futures Processor)
 *
 * 核心职责：处理币本位 (Coin-M) 反向合约数据。
 *
 * 业务逻辑：
 * 1. 这是一个 **反向合约 (Inverse Contract)** 模型。
 * 2. 合约面值 (Contract Value) 是固定的（例如 1张 = 100 USD）。
 * 3. 所有的保证金、盈亏结算都使用 **基础货币 (Base Asset, 如 BTC)**。
 *
 * 核心公式：
 * - PnL (Long)  = 数量 * 合约面值 * (1 / 开仓价 - 1 / 平仓价)
 * - PnL (Short) = 数量 * 合约面值 * (1 / 平仓价 - 1 / 开仓价)
 *
 * 特性：
 * - 币种：盈亏币种 (pnlCurrency) = BTC/ETH 等。
 * - 名义价值：以 USD 计价。
 */
export class BinanceCMFuturesTradeProcessor {
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
        rawFills.sort((a, b) => parseInt(a.ts) - parseInt(b.ts));

        const { closedTrades, openPositions } = this._processFillsAndAggregateTrades(rawFills);
        this._applyBillsAndRisks(closedTrades, openPositions, rawBills, rawPositionRisks);

        const allTrades = [...closedTrades, ...Array.from(openPositions.values())];
        this._finalizeTradeMetrics(allTrades);

        return allTrades;
    }

    private _processFillsAndAggregateTrades(rawFills: RawFill[]): { closedTrades: StandardizedTrade[], openPositions: Map<string, StandardizedTrade> } {
        const openPositions = new Map<string, StandardizedTrade>();
        const closedTrades: StandardizedTrade[] = [];

        for (const fill of rawFills) {
            const positionKey = `${fill.instId}-${fill.posSide}`;
            let trade = openPositions.get(positionKey);

            const fillSide = fill.side.toLowerCase();
            const positionSide = fill.posSide.toLowerCase();
            const isOpeningFill = (positionSide === 'long' && fillSide === 'buy') || (positionSide === 'short' && fillSide === 'sell');

            if (!trade && !isOpeningFill) {
                continue;
            }

            if (!trade) {
                trade = this._createNewTrade(fill);
                openPositions.set(positionKey, trade);
            }

            this._updateTradeWithFill(trade, fill);

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
        const positionSide = fill.posSide.toLowerCase();
        const fillSide = fill.side.toLowerCase();
        const instrument = this.instruments.get(fill.instId);

        // Coin-M: Base Asset is the PnL currency (e.g. BTC in BTCUSD_PERP)
        const pnlCcy = instrument ? instrument.baseCcy : 'Unknown';
        // Coin-M: value is usually in USD
        const valCcy = instrument ? instrument.quoteCcy : 'USD';

        let direction: TradeDirection;
        if (positionSide === 'long') {
            direction = TradeDirection.LONG;
        } else if (positionSide === 'short') {
            direction = TradeDirection.SHORT;
        } else {
            direction = fillSide === 'buy' ? TradeDirection.LONG : TradeDirection.SHORT;
        }

        return {
            id: `${fill.instId}-${positionSide}-${fillTimestamp}`,
            symbol: fill.instId,
            direction: direction,
            status: PositionStatus.OPEN,
            entryTime: fillTimestamp,
            exitTime: 0,
            durationMs: 0,
            totalSize: 0, // In Contracts (sheets)
            totalValue: 0, // In USD
            averageEntryPrice: 0,
            averageExitPrice: 0,
            realizedPnl: 0, // In Coin
            totalCommission: 0,
            totalFundingFee: 0,
            netPnl: 0,
            pnlPercentage: 0,
            timeline: [],
            tradeIds: [],
            orderIds: [],
            notes: '',
            tags: [],
            _currentPositionSize: 0,
            _closingSizeAccumulator: 0,
            _closingValueAccumulator: 0,
            _rawFills: [],
            _rawBills: [],
            currentNotionalValue: undefined,
            pnlCurrency: pnlCcy,
            feeCurrency: fill.feeCcy, // Initial guess
            valueCurrency: valCcy
        };
    }

    private _updateTradeWithFill(trade: StandardizedTrade, fill: RawFill): void {
        const fillSide = fill.side.toLowerCase();
        const fillPrice = parseFloat(fill.fillPx);
        // Coin-M fillSz is number of contracts
        const fillSizeContracts = parseFloat(fill.fillSz);

        const instrument = this.instruments.get(fill.instId);
        // ctVal is e.g. "100" (USD) or "10"
        const contractValueUsd = instrument ? parseFloat(instrument.ctVal) : 100; // Default fallback dangerous but necessary

        // Notional Value in USD = Contracts * ContractValue
        const fillNotionalUsd = fillSizeContracts * contractValueUsd;
        // Cost in Coin = Notional USD / Price
        const fillCostCoin = fillNotionalUsd / fillPrice;

        const timelineEvent: TimelineEvent = {
            timestamp: parseInt(fill.ts),
            action: 'UNKNOWN' as any,
            size: fillSizeContracts, // Storing size in Contracts for Coin-M? Or Coin? Usually Contracts is more intuitive for traders
            price: fillPrice,
            notes: undefined,
            tradeId: fill.tradeId,
            orderId: fill.ordId,
            fee: parseFloat(fill.fee || '0'),
            feeCcy: fill.feeCcy
        };

        const isCurrentLong = trade.direction === TradeDirection.LONG;
        const isFillDirectionBuy = fillSide === 'buy';

        if ((isCurrentLong && isFillDirectionBuy) || (!isCurrentLong && !isFillDirectionBuy)) {
            // OPEN / ADD
            timelineEvent.action = trade.timeline.length > 0 ? 'ADD' : 'OPEN';

            // Average Entry Price for Coin-M (Inverse)
            // Total Contracts / (Total Contracts / AvgPrice + New Contracts / NewPrice) -- Harmonic Mean
            // Or simpler: Total Value USD / Total Cost Coin
            const currentCostCoin = trade.totalValue / trade.averageEntryPrice; // Infer existing cost if valid

            // Wait, trade.totalValue usually stores "Cost" or "Notional"?
            // In U-based, totalValue = Size * Price (Notional).
            // In Coin-M, let's keep totalValue = Notional USD.

            // To calculate new avg entry price:
            // New Avg Price = (Total Notional USD) / (Total Cost Coin)
            // Total Cost Coin = Previous Cost Coin + New Cost Coin

            // If first trade:
            let previousCostCoin = 0;
            if (trade.totalSize > 0 && trade.averageEntryPrice > 0) {
                // previousCostCoin = trade.totalValue / trade.averageEntryPrice; // This math holds for Inverse?
                // Inverse: Cost (Coin) = Notional (USD) / Price
                // So Notional (USD) = Cost (Coin) * Price
                // AvgPrice = Notional / Cost. Yes.
                previousCostCoin = trade.totalValue / trade.averageEntryPrice;
            }

            const newTotalNotionalUsd = trade.totalValue + fillNotionalUsd;
            const newTotalCostCoin = previousCostCoin + fillCostCoin;

            trade.averageEntryPrice = newTotalNotionalUsd / newTotalCostCoin;
            trade.totalSize += fillSizeContracts;
            trade.totalValue = newTotalNotionalUsd;

            trade._currentPositionSize += fillSizeContracts;

        } else {
            // REDUCE / CLOSE
            timelineEvent.action = 'REDUCE';
            const sizeReducedContracts = Math.min(fillSizeContracts, trade._currentPositionSize);

            // PnL Calculation for Inverse:
            // Long:  contracts * ctVal * (1/Entry - 1/Exit)
            // Short: contracts * ctVal * (1/Exit - 1/Entry)

            const notionalReducedUsd = sizeReducedContracts * contractValueUsd;

            let pnlCoin = 0;
            if (trade.direction === TradeDirection.LONG) {
                pnlCoin = notionalReducedUsd * (1 / trade.averageEntryPrice - 1 / fillPrice);
            } else {
                pnlCoin = notionalReducedUsd * (1 / fillPrice - 1 / trade.averageEntryPrice);
            }

            trade.realizedPnl += pnlCoin;
            trade._currentPositionSize -= sizeReducedContracts;

            // For avg exit price, linear weighted average of exit prices is fine
            // Or harmonically? Usually linear is displayed for exits.
            trade._closingSizeAccumulator += sizeReducedContracts;
            trade._closingValueAccumulator += (sizeReducedContracts * fillPrice);

            if (trade._currentPositionSize <= FLOATING_POINT_TOLERANCE) {
                timelineEvent.action = 'CLOSE';
                trade._currentPositionSize = 0;
            }
        }

        trade.totalCommission += timelineEvent.fee; // Assume distinct assets? NO, usually all fees in Coin.
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
            // Simple arithmetic mean for exit price display
            trade.averageExitPrice = trade._closingValueAccumulator / trade._closingSizeAccumulator;
        } else {
            trade.averageExitPrice = 0;
        }
    }

    private _applyBillsAndRisks(closedTrades: StandardizedTrade[], openPositions: Map<string, StandardizedTrade>, rawBills: Bill[], rawPositionRisks: RawPositionRisk[]): void {
        const allTrades = [...closedTrades, ...Array.from(openPositions.values())];
        const tradesBySymbol = new Map<string, StandardizedTrade[]>();

        for (const trade of allTrades) {
            if (!tradesBySymbol.has(trade.symbol)) {
                tradesBySymbol.set(trade.symbol, []);
            }
            tradesBySymbol.get(trade.symbol)!.push(trade);
        }

        for (const bill of rawBills) {
            if (bill.type === BILL_TYPE_FUNDING_FEE) {
                const relevantTrades = tradesBySymbol.get(bill.instId) || [];
                for (const trade of relevantTrades) {
                    const billTimestamp = parseInt(bill.ts);
                    if (billTimestamp >= trade.entryTime && (trade.status === PositionStatus.OPEN || billTimestamp <= trade.exitTime)) {
                        trade.totalFundingFee += parseFloat(bill.balChg);
                        trade._rawBills.push(bill);
                        break;
                    }
                }
            }
        }

        for (const rawRisk of rawPositionRisks) {
            const positionKey = `${rawRisk.symbol}-${rawRisk.positionSide.toLowerCase()}`;
            const trade = openPositions.get(positionKey);
            if (trade) {
                trade.currentNotionalValue = parseFloat(rawRisk.notional);
            }
        }
    }

    private _finalizeTradeMetrics(allTrades: StandardizedTrade[]): void {
        allTrades.forEach(trade => {
            // Aggregate timeline events before finalizing metrics
            trade.timeline = this._aggregateTimelineEvents(trade.timeline);

            trade.netPnl = trade.realizedPnl - trade.totalCommission + trade.totalFundingFee;
            // PnL % for Inverse? 
            // Return % = PnL (Coin) / Initial Margin (Coin).
            // But we don't know leverage accurately to know Initial Margin.
            // Often ROI = PnL (Coin) / Cost (Coin).

            const costCoin = trade.totalValue / trade.averageEntryPrice; // Approximate cost basis in Coin
            if (costCoin !== 0) {
                trade.pnlPercentage = trade.netPnl / costCoin;
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
            const prev = currentGroup[currentGroup.length - 1];
            const current = timeline[i];
            const timeDiff = current.timestamp - prev.timestamp;

            const isSameAction = current.action === prev.action;
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
        // Linear Weighted Average for display
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
            size: totalSz, // Contracts
            fee: totalFee,
            action: mergedAction,
            notes: events.map(e => e.notes).filter(n => n).join('; ') || undefined
        };
    }
}
