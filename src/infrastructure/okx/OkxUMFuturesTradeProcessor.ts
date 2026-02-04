
import { OkxFill, OkxBill, OkxInstrument, OkxPosition } from './types';
import { InstrumentDetail, StandardizedTrade, TimelineEvent, TradeDirection, PositionStatus } from '../../models/types';
import { OkxApiClient } from './OkxApiClient';
import { OkxTradeBuilder } from './OkxTradeBuilder';
import { SafeParsers } from './SafeParsers';
import { TimelineUtils } from '../../utils/TimelineUtils';

/**
 * OKX U-Margined Futures Trade Processor
 * 
 * 职责：负责将 OKX 的原始数据流（Fills, Bills, Positions）转换为标准化的 StandardizedTrade 对象。
 * 
 * 重构改进 (2025 Refactor):
 * 1. 引入 TradeBuilder 模式，解耦状态管理逻辑。
 * 2. 优化算法复杂度：资金费用匹配从 O(N*M) 优化为 O(N + M*logM) (Map lookup)。
 * 3. 增强健壮性：全面引入 SafeParsers 处理数值解析。
 * 4. 提升可读性：移除魔术数字，提取私有方法。
 */
export class OkxUMFuturesTradeProcessor {
    private instruments: Map<string, OkxInstrument>;
    private apiClient: OkxApiClient;

    constructor(apiClient: OkxApiClient) {
        this.apiClient = apiClient;
        this.instruments = new Map<string, OkxInstrument>();
    }

    private lastOpenPositions: Map<string, OkxTradeBuilder> = new Map();

    public async processAllData(
        rawFills: OkxFill[],
        rawBills: OkxBill[],
        instruments: OkxInstrument[],
        positions: OkxPosition[]
    ): Promise<StandardizedTrade[]> {
        // 1. 建立基础数据索引
        this.instruments.clear();
        instruments.forEach(inst => this.instruments.set(inst.instId, inst));

        // 2. 预排序 Fills (保证时序正确)
        // 使用稳定的排序逻辑：时间戳 -> tradeId
        rawFills.sort((a, b) => {
            const tsDiff = SafeParsers.integer(a.ts) - SafeParsers.integer(b.ts);
            if (tsDiff !== 0) return tsDiff;
            return (a.tradeId || '').localeCompare(b.tradeId || '');
        });

        // 3. 核心处理：构建交易 (Event Sourcing)
        const { closedTrades, openPositions } = this.processFills(rawFills);
        this.lastOpenPositions = openPositions; // Store for cache retrieval

        // 4. 关联资金流与风险数据 (Enrichment)
        this.applyBillsAndRisks(closedTrades, openPositions, rawBills, positions);

        // 5. 最终计算与清理 (Finalization)
        const allTrades = [...closedTrades, ...Array.from(openPositions.values()).map(b => b.getTrade())];
        this.finalizeMetrics(allTrades);

        return allTrades;
    }

    public getOpenPositionFills(): OkxFill[] {
        const fills: OkxFill[] = [];
        for (const builder of this.lastOpenPositions.values()) {
            // access private trade? no, use getTrade()
            const trade = builder.getTrade();
            if (trade._rawFills) {
                fills.push(...(trade._rawFills as unknown as OkxFill[]));
            }
        }
        return fills;
    }

    /**
     * 第一阶段：处理成交记录，构建交易生命周期
     */
    private processFills(rawFills: OkxFill[]): {
        closedTrades: StandardizedTrade[],
        openPositions: Map<string, OkxTradeBuilder>
    } {
        const openPositions = new Map<string, OkxTradeBuilder>();
        const closedTrades: StandardizedTrade[] = [];

        for (const fill of rawFills) {
            // 生成唯一仓位标识 key (e.g. "BTC-USDT-SWAP-long")
            const positionKey = `${fill.instId}-${fill.posSide.toLowerCase()}`;

            let builder = openPositions.get(positionKey);

            if (!builder) {
                // 如果是开仓单 (或 Net 模式的第一单)，创建新构建器
                // 注意：这里需要识别这是否是一个真正的“新”交易。
                // 如果是“Reduce”类型的单子但没有对应的 Builder，说明是数据缺失或孤儿单，应忽略。
                // 但 TradeBuilder 内部逻辑能更好处理 Action 判断，我们这里先尝试创建。
                // 真正的防守逻辑：如果 fill 明显是平仓单且没有 builder，则跳过？
                // 为了简化，我们交给 TradeBuilder 的构造函数去初始化。
                // 但我们需要 Contract Value。
                const instrument = this.instruments.get(fill.instId);
                const contractValue = instrument ? SafeParsers.float(instrument.ctVal, 1.0) : 1.0;

                // 简单的孤儿单过滤：如果 fill 是 long+sell 或 short+buy 且没有 builder，可能是历史遗留的平仓单
                const isReduce = this.isReduceOnly(fill);
                if (isReduce) {
                    // console.warn(`[OkxProcessor] Skipping orphan closing fill: ${positionKey} ${fill.ts}`);
                    continue;
                }

                const isInverse = fill.instId.includes('-USD-') && !fill.instId.includes('-USDT-');
                builder = new OkxTradeBuilder(fill, contractValue, isInverse);
                openPositions.set(positionKey, builder);
            } else {
                builder.addFill(fill);
            }

            // 检查交易是否已结束
            if (builder.isClosed()) {
                closedTrades.push(builder.getTrade());
                openPositions.delete(positionKey);
            }
        }

        return { closedTrades, openPositions };
    }

    /**
     * 辅助判断是否显式为减仓单 (用于过滤孤儿单)
     */
    private isReduceOnly(fill: OkxFill): boolean {
        const side = fill.side.toLowerCase();
        const posSide = fill.posSide.toLowerCase();
        // Long + Sell = Reduce
        // Short + Buy = Reduce
        if (posSide === 'long' && side === 'sell') return true;
        if (posSide === 'short' && side === 'buy') return true;
        return false;
    }

    /**
     * 第二阶段：应用资金费用和持仓风险数据
     * 优化：使用 Map 索引 Bill，避免 O(N*M) 复杂度
     */
    private applyBillsAndRisks(
        closedTrades: StandardizedTrade[],
        openPositions: Map<string, OkxTradeBuilder>,
        rawBills: OkxBill[],
        positions: OkxPosition[]
    ): void {
        const allTrades = [...closedTrades, ...Array.from(openPositions.values()).map(b => b.getTrade())];

        // 1. 建立 Bill 索引: Map<instId, Bill[]>
        const billsBySymbol = new Map<string, OkxBill[]>();
        for (const bill of rawBills) {
            // Type '8' is funding fee
            if (bill.type === '8') {
                if (!billsBySymbol.has(bill.instId)) {
                    billsBySymbol.set(bill.instId, []);
                }
                billsBySymbol.get(bill.instId)!.push(bill);
            }
        }

        // 2. 批量匹配 Funding Fee
        for (const trade of allTrades) {
            const potentialBills = billsBySymbol.get(trade.symbol);
            if (!potentialBills) continue;

            for (const bill of potentialBills) {
                const billTs = SafeParsers.integer(bill.ts);

                // 时间范围检查：[Entry, Exit]
                // 对于未结仓位，ExitTime 为 0 (或非常大，但在 builder 中初始化为 0)
                // 逻辑：billTs >= Entry AND (isOpen OR billTs <= Exit)
                const isRelevant = billTs >= trade.entryTime &&
                    (trade.status === PositionStatus.OPEN || billTs <= trade.exitTime);

                if (isRelevant) {
                    const feeAmount = SafeParsers.float(bill.balChg);
                    trade.totalFundingFee += feeAmount;
                    trade._rawBills.push(bill as any);
                }
            }
        }

        // 3. 应用当前持仓风险 (Notional Value)
        for (const risk of positions) {
            const positionKey = `${risk.instId}-${risk.posSide.toLowerCase()}`;
            const builder = openPositions.get(positionKey);
            if (builder) {
                const trade = builder.getTrade();
                trade.currentNotionalValue = SafeParsers.float(risk.notionalUsd);
            }
        }
    }

    /**
     * 第三阶段：计算最终指标 (Net PnL, %)
     */
    private finalizeMetrics(trades: StandardizedTrade[]): void {
        for (const trade of trades) {
            // Aggregate timeline events using unified utility
            trade.timeline = TimelineUtils.aggregateEvents(trade.timeline);

            // netPnl = realized + funding - commission
            trade.netPnl = trade.realizedPnl - trade.totalCommission + trade.totalFundingFee;

            if (trade.totalValue > 0) {
                trade.pnlPercentage = trade.netPnl / trade.totalValue;
            } else {
                trade.pnlPercentage = 0;
            }
        }
    }
}
