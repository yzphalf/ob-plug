import { StandardizedTrade, TimelineEvent, TradeDirection, PositionStatus } from '../../models/types';
import { OkxFill } from './types';
import { SafeParsers } from './SafeParsers';

/**
 * 交易构建器 (Trade Builder)
 * 
 * 职责：封装单个交易的生命周期管理。
 * 解决了“状态管理分散”的问题，保证交易状态变更的原子性和一致性。
 */
export class OkxTradeBuilder {
    private trade: StandardizedTrade;
    private readonly FLOATING_POINT_TOLERANCE = 1e-9;
    private contractValue: number = 1;
    private isInverse: boolean = false;

    constructor(firstFill: OkxFill, contractValue: number = 1, isInverse: boolean = false) {
        this.contractValue = contractValue;
        this.isInverse = isInverse;
        this.trade = this.initializeTrade(firstFill);
        this.addFill(firstFill);
    }

    public getTrade(): StandardizedTrade {
        return this.trade;
    }

    public isClosed(): boolean {
        return this.trade.status === PositionStatus.CLOSED;
    }

    /**
     * 处理新的成交记录
     */
    public addFill(fill: OkxFill): void {
        const fillPrice = SafeParsers.float(fill.fillPx);
        const fillSz = SafeParsers.float(fill.fillSz);

        // Calculate Size based on contract type
        // Linear: Size = Contracts * ContractVal(Coins) => Result in Coins
        // Inverse: Size = Contracts * ContractVal(USD) => Result in USD
        const eventSize = fillSz * this.contractValue;

        // 费用标准化
        const rawFee = SafeParsers.float(fill.fee);
        const normalizedFee = -rawFee;

        // 确定动作类型
        const action = this.determineAction(fill, this.trade.direction);

        // 创建时间线事件
        const event: TimelineEvent = {
            timestamp: SafeParsers.integer(fill.ts),
            action: action,
            size: eventSize,
            price: fillPrice,
            tradeId: fill.tradeId,
            orderId: fill.ordId,
            fee: normalizedFee,
            feeCcy: fill.feeCcy
        };

        // 更新交易状态
        this.updateState(event);

        // 记录原始数据引用
        this.trade.timeline.push(event);
        this.trade.tradeIds.push(fill.tradeId);
        if (!this.trade.orderIds.includes(fill.ordId)) {
            this.trade.orderIds.push(fill.ordId);
        }
        this.trade._rawFills.push(fill as any);
    }

    private initializeTrade(fill: OkxFill): StandardizedTrade {
        const ts = SafeParsers.integer(fill.ts);
        const direction = this.determineDirection(fill);

        // Determine currencies
        // Inverse: Value & Fee often in base coin (BTC), PnL in base coin. 
        // Linear: Value in USDT, Fee mixed, PnL in USDT.
        // We set defaults here, logic below might refine.
        // For Inverse: instId 'BTC-USD-SWAP'. baseCcy=BTC/USD? No, usually underlying.
        // Let's rely on passed flags or inference if possible.
        // Ideally we parse instId or receive currency info.
        // For now, if inverse, we assume FeeCcy is the base currency.
        const defaultFeeCcy = fill.feeCcy || 'USDT';
        const pnlCcy = this.isInverse ? (fill.feeCcy || 'BTC') : 'USDT'; // Best guess if inverse
        const valCcy = this.isInverse ? 'USD' : 'USDT'; // For Inverse, Size is in USD.

        return {
            id: `${fill.instId}-${fill.posSide}-${ts}`,
            symbol: fill.instId,
            direction: direction,
            status: PositionStatus.OPEN,
            entryTime: ts,
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
            tags: [],
            _currentPositionSize: 0,
            _closingSizeAccumulator: 0,
            _closingValueAccumulator: 0,
            _rawFills: [],
            _rawBills: [],
            pnlCurrency: pnlCcy,
            feeCurrency: defaultFeeCcy,
            valueCurrency: valCcy
        };
    }

    private determineDirection(fill: OkxFill): TradeDirection {
        const posSide = fill.posSide.toLowerCase();
        if (posSide === 'long') return TradeDirection.LONG;
        if (posSide === 'short') return TradeDirection.SHORT;
        return fill.side.toLowerCase() === 'buy' ? TradeDirection.LONG : TradeDirection.SHORT;
    }

    private determineAction(fill: OkxFill, direction: TradeDirection): TimelineEvent['action'] {
        const isLong = direction === TradeDirection.LONG;
        const isBuy = fill.side.toLowerCase() === 'buy';
        const isHooksIncrease = (isLong && isBuy) || (!isLong && !isBuy);

        if (isHooksIncrease) {
            return this.trade.timeline.length === 0 ? 'OPEN' : 'ADD';
        } else {
            return 'REDUCE';
        }
    }

    private updateState(event: TimelineEvent): void {
        if (event.action === 'OPEN' || event.action === 'ADD') {
            // == COST CALCULATION ==
            let addedCost = 0;
            if (this.isInverse) {
                // Inverse: Cost (Coins) = Size (USD) / Price
                if (event.price > 0) addedCost = event.size / event.price;
            } else {
                // Linear: Cost (USDT) = Size (Coins) * Price
                addedCost = event.size * event.price;
            }

            const newTotalCost = this.trade.totalValue + addedCost; // totalValue holds the Cost Basis
            const newTotalSize = this.trade.totalSize + event.size;

            if (newTotalSize > 0 && newTotalCost > 0) {
                if (this.isInverse) {
                    // Inverse Avg Price = TotalSize(USD) / TotalCost(Coins)
                    this.trade.averageEntryPrice = newTotalSize / newTotalCost;
                } else {
                    // Linear Avg Price = TotalCost(USDT) / TotalSize(Coins)
                    this.trade.averageEntryPrice = newTotalCost / newTotalSize;
                }
            }

            this.trade.totalSize = newTotalSize;
            this.trade.totalValue = newTotalCost;
            this.trade._currentPositionSize += event.size;

        } else {
            // REDUCE or CLOSE
            const sizeReduced = Math.min(event.size, this.trade._currentPositionSize);
            const isLong = this.trade.direction === TradeDirection.LONG;

            // == PNL CALCULATION ==
            let pnl = 0;
            if (this.isInverse) {
                // Inverse PnL (Coins)
                // Long: Size * (1/Entry - 1/Exit)
                // Short: Size * (1/Exit - 1/Entry)
                // Note: Entry/Exit are Prices. Size is USD.

                // Avoid division by zero
                if (this.trade.averageEntryPrice > 0 && event.price > 0) {
                    if (isLong) {
                        pnl = sizeReduced * (1 / this.trade.averageEntryPrice - 1 / event.price);
                    } else {
                        pnl = sizeReduced * (1 / event.price - 1 / this.trade.averageEntryPrice);
                    }
                }
            } else {
                // Linear PnL (USDT)
                // (Exit - Entry) * Size * direction
                pnl = (event.price - this.trade.averageEntryPrice) * sizeReduced * (isLong ? 1 : -1);
            }

            this.trade.realizedPnl += pnl;
            this.trade._currentPositionSize -= sizeReduced;

            // Track exit stats
            this.trade._closingSizeAccumulator += sizeReduced;

            // For avg exit price, we need value accumulator
            // Linear value: Size * Price
            // Inverse value: Since we want AvgExitPrice to be USD/Coin, and Size is USD...
            // Standard approach: Sum(Size in USD) / Sum(Cost in Coins at Exit)?
            // Or just simplified: Sum(Price * Weight)?
            // Let's stick to standard Value accumulator logic:
            if (this.isInverse) {
                // Inverse Value logic for Avg: similar to Entry.
                // Value = Size(USD) / Price(Coins).
                // We want AvgExit = Sum(Size) / Sum(Cost at exit).
                if (event.price > 0) {
                    this.trade._closingValueAccumulator += (sizeReduced / event.price);
                }
            } else {
                this.trade._closingValueAccumulator += (sizeReduced * event.price);
            }

            // Check if closed
            if (this.trade._currentPositionSize <= this.FLOATING_POINT_TOLERANCE) {
                event.action = 'CLOSE';
                this.trade.status = PositionStatus.CLOSED;
                this.trade.exitTime = event.timestamp;
                this.trade.durationMs = this.trade.exitTime - this.trade.entryTime;

                if (this.trade._closingSizeAccumulator > 0) {
                    if (this.isInverse) {
                        this.trade.averageExitPrice = this.trade._closingValueAccumulator > 0
                            ? this.trade._closingSizeAccumulator / this.trade._closingValueAccumulator
                            : 0;
                    } else {
                        this.trade.averageExitPrice = this.trade._closingValueAccumulator / this.trade._closingSizeAccumulator;
                    }
                }
                this.trade._currentPositionSize = 0;
            }
        }

        this.trade.totalCommission += (event.fee || 0);
    }
}
