
import { RawFill, StandardizedTrade, TimelineEvent, TradeDirection, PositionStatus } from '../../models/types';
import { SafeParsers } from '../okx/SafeParsers'; // Reuse SafeParsers

/**
 * Binance 交易构建器 (Builder Pattern)
 * 
 * 职责：
 * 1. 封装单个交易 (Trade) 的生命周期状态管理。
 * 2. 接收 Fills 流，自动判断是 Open/Add 还是 Reduce/Close。
 * 3. 实时计算均价、盈亏、手续费等核心指标。
 * 4. 保证由不完整数据构建出的 Trade 对象始终保持内部一致性。
 */
export class BinanceTradeBuilder {
    private trade: StandardizedTrade;
    private contractValue: number;

    /**
     * @param firstFill 触发开仓的第一笔成交
     * @param contractValue 合约面值 (用于计算真实数量) -> Binance 通常 ctVal 是 1 或 数量已经调整? 
     * Binance API return size in explicit coins usually. ctVal usually 1 for USDT-M.
     * But we keep it as parameter for safety.
     */
    constructor(firstFill: RawFill, contractValue: number = 1) {
        this.contractValue = contractValue;
        this.trade = this.initializeTrade(firstFill);
        this.addFill(firstFill);
    }

    public getTrade(): StandardizedTrade {
        return this.trade;
    }

    public isClosed(): boolean {
        return this.trade.status === PositionStatus.CLOSED;
    }

    public addFill(fill: RawFill): void {
        const fillPrice = SafeParsers.float(fill.fillPx);
        const fillSize = SafeParsers.float(fill.fillSz) * this.contractValue;
        const fillFee = SafeParsers.float(fill.fee);
        // Binance: fee is positive cost usually.
        // We accumulate generic totalCommission.

        const timestamp = SafeParsers.integer(fill.ts);

        const timelineEvent: TimelineEvent = {
            timestamp: timestamp,
            action: 'UNKNOWN' as any,
            size: fillSize,
            price: fillPrice,
            tradeId: fill.tradeId,
            orderId: fill.ordId,
            fee: fillFee,
            feeCcy: fill.feeCcy
        };

        const isLong = this.trade.direction === TradeDirection.LONG;
        const isBuy = fill.side.toLowerCase() === 'buy';

        // 判断动作类型
        // Long + Buy = Add
        // Short + Sell = Add
        // Long + Sell = Reduce
        // Short + Buy = Reduce
        let isAdd = false;
        if (isLong) {
            isAdd = isBuy;
        } else {
            isAdd = !isBuy;
        }

        // 第一笔已经在 constructor 初始化时 addFill，但 action 需要区分。
        // 如果是已存在的 trade，timeline 长度 > 0。
        // 对于 constructor 调用 addFill 时，timeline 为空 -> Open。
        if (this.trade.timeline.length === 0) {
            timelineEvent.action = 'OPEN';
        } else if (isAdd) {
            timelineEvent.action = 'ADD';
        } else {
            timelineEvent.action = 'REDUCE';
        }

        this.applyEvent(timelineEvent, isLong);

        // 记录原始数据
        this.trade._rawFills.push(fill);
        if (!this.trade.tradeIds.includes(fill.tradeId)) this.trade.tradeIds.push(fill.tradeId);
        if (!this.trade.orderIds.includes(fill.ordId)) this.trade.orderIds.push(fill.ordId);

        // 更新额外统计
        this.trade.totalCommission += fillFee; // Binance fee is typically positive

        // 自动检测平仓
        if (timelineEvent.action === 'REDUCE') {
            if (this.trade._currentPositionSize <= 1e-9) { // Floating point tolerance
                this.closeTrade(timestamp);
                timelineEvent.action = 'CLOSE'; // 修正最后一个事件为 CLOSE
            }
        }
    }

    private initializeTrade(fill: RawFill): StandardizedTrade {
        const timestamp = SafeParsers.integer(fill.ts);
        const positionSide = fill.posSide.toLowerCase();
        const fillSide = fill.side.toLowerCase();

        let direction: TradeDirection;
        if (positionSide === 'long') {
            direction = TradeDirection.LONG;
        } else if (positionSide === 'short') {
            direction = TradeDirection.SHORT;
        } else {
            // Net/Both mode
            direction = fillSide === 'buy' ? TradeDirection.LONG : TradeDirection.SHORT;
        }

        return {
            id: `${fill.instId}-${fill.posSide}-${timestamp}`,
            symbol: fill.instId,
            direction: direction,
            status: PositionStatus.OPEN,
            entryTime: timestamp,
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
            pnlCurrency: 'USDT', // U-Based default
            feeCurrency: fill.feeCcy || 'USDT',
            valueCurrency: 'USDT'
        };
    }

    private applyEvent(event: TimelineEvent, isLong: boolean): void {
        const { price, size, action } = event;

        if (action === 'OPEN' || action === 'ADD') {
            const newSize = this.trade.totalSize + size;
            const newVal = this.trade.totalValue + (size * price);

            if (newSize > 0) {
                this.trade.averageEntryPrice = newVal / newSize;
            }

            this.trade.totalSize = newSize;
            this.trade.totalValue = newVal;
            this.trade._currentPositionSize += size;

        } else if (action === 'REDUCE' || action === 'CLOSE') {
            const reduceSize = Math.min(size, this.trade._currentPositionSize);

            // PnL Calculation
            // Long: (Exit - Entry) * Size
            // Short: (Entry - Exit) * Size
            const pnl = (price - this.trade.averageEntryPrice) * reduceSize * (isLong ? 1 : -1);

            this.trade.realizedPnl += pnl;
            this.trade._currentPositionSize -= reduceSize;

            this.trade._closingSizeAccumulator += reduceSize;
            this.trade._closingValueAccumulator += (reduceSize * price);
        }

        this.trade.timeline.push(event);
    }

    private closeTrade(exitTime: number): void {
        this.trade.status = PositionStatus.CLOSED;
        this.trade.exitTime = exitTime;
        this.trade.durationMs = this.trade.exitTime - this.trade.entryTime;

        if (this.trade._closingSizeAccumulator > 0) {
            this.trade.averageExitPrice = this.trade._closingValueAccumulator / this.trade._closingSizeAccumulator;
        }
    }
}
