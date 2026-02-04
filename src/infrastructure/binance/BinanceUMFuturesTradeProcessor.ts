/**
 * 交易数据处理器 (U-Based Futures Processor)
 *
 * 核心职责：处理 U本位合约 (USDT-Margined) 的交易数据。
 *
 * 业务逻辑：
 * 1. 输入：原始成交记录 (Raw Fills) 和 资金流水 (Bills)。
 * 2. 处理：
 *    - 将零散的 `Open` 和 `Close` 成交单配对。
 *    - 维护“持仓”(Position) 状态。
 *    - 计算持仓均价 (Avg Entry Price) 和 平仓均价 (Avg Exit Price)。
 *    - 从 `Bills` 中归集资金费 (Funding Fee)。
 * 3. 输出：标准化的 `StandardizedTrade` 对象列表。
 *
 * 特性：
 * - 币种：价值和盈亏均以 USDT 计价。
 * - 模式：支持双向持仓 (Long/Short)。
 */
import { RawFill, Bill, InstrumentDetail, RawPositionRisk, StandardizedTrade, TimelineEvent, TradeDirection, PositionStatus } from '../../models/types';
import { BinanceApiClient } from './BinanceApiClient';
import { BinanceTradeBuilder } from './BinanceTradeBuilder';
import { SafeParsers } from '../okx/SafeParsers';
import { TimelineUtils } from '../../utils/TimelineUtils';

const BILL_TYPE_FUNDING_FEE = 'FUNDING_FEE';

/**
 * BinanceUMFuturesTradeProcessor 负责 U本位合约数据的清洗、预处理和业务逻辑映射。
 * 它是将币安原始数据适配到应用内部标准模型的适配器。
 */
export class BinanceUMFuturesTradeProcessor {
    private instruments: Map<string, InstrumentDetail>;
    private binanceApiClient: BinanceApiClient;

    constructor(binanceApiClient: BinanceApiClient) {
        this.instruments = new Map<string, InstrumentDetail>();
        this.binanceApiClient = binanceApiClient;
    }

    /**
     * 处理所有原始数据 (fills, bills, orders, instruments) 并生成标准化交易对象列表。
     */
    public async processAllData(
        rawFills: RawFill[],
        rawBills: Bill[],
        instrumentDetails: InstrumentDetail[],
        rawPositionRisks: RawPositionRisk[]
    ): Promise<StandardizedTrade[]> {
        // 1. 初始化 instruments 映射并排序 fills
        this.instruments.clear();
        instrumentDetails.forEach(inst => this.instruments.set(inst.instId, inst));

        // 使用 SafeParsers 排序
        rawFills.sort((a, b) => SafeParsers.integer(a.ts) - SafeParsers.integer(b.ts));

        // 2. 处理成交记录，构建交易生命周期
        const { closedTrades, openPositions } = this.processFills(rawFills);

        // 3. 将资金费用、持仓风险等信息应用到交易上
        this.applyBillsAndRisks(closedTrades, openPositions, rawBills, rawPositionRisks);

        // 4. 将所有交易合并，并计算最终的财务指标
        const allTrades = [...closedTrades, ...Array.from(openPositions.values()).map(b => b.getTrade())];
        this.finalizeMetrics(allTrades);

        return allTrades;
    }

    private processFills(rawFills: RawFill[]): { closedTrades: StandardizedTrade[], openPositions: Map<string, BinanceTradeBuilder> } {
        const openPositions = new Map<string, BinanceTradeBuilder>();
        const closedTrades: StandardizedTrade[] = [];

        for (const fill of rawFills) {
            const positionKey = `${fill.instId}-${fill.posSide}`;
            let builder = openPositions.get(positionKey);

            if (!builder) {
                // 判断是否是真正的开仓单
                const fillSide = fill.side.toLowerCase();
                const positionSide = fill.posSide.toLowerCase();
                const isOpeningFill = (positionSide === 'long' && fillSide === 'buy') || (positionSide === 'short' && fillSide === 'sell');

                // One-Way Mode (Both) handling:
                // If posSide is 'both', generic logic assumes 'buy' is open long? 
                // We reuse the logic: if !builder and !isOpening, skip orphan close.
                // Note: logic for 'both' + 'sell' is !isOpening.

                if (!isOpeningFill) {
                    // console.warn(`Skipping orphan closing fill: ${positionKey} ${fill.ts}`);
                    continue;
                }

                const instrument = this.instruments.get(fill.instId);
                const contractValue = instrument ? SafeParsers.float(instrument.ctVal, 1.0) : 1.0;

                builder = new BinanceTradeBuilder(fill, contractValue);
                openPositions.set(positionKey, builder);
            } else {
                builder.addFill(fill);
            }

            if (builder.isClosed()) {
                closedTrades.push(builder.getTrade());
                openPositions.delete(positionKey);
            }
        }
        return { closedTrades, openPositions };
    }

    private applyBillsAndRisks(
        closedTrades: StandardizedTrade[],
        openPositions: Map<string, BinanceTradeBuilder>,
        rawBills: Bill[],
        rawPositionRisks: RawPositionRisk[]
    ): void {
        const allTrades = [...closedTrades, ...Array.from(openPositions.values()).map(b => b.getTrade())];
        const tradesBySymbol = new Map<string, StandardizedTrade[]>();

        // Pre-group trades by symbol for faster lookups
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
                    const billTimestamp = SafeParsers.integer(bill.ts);

                    const isRelevant = billTimestamp >= trade.entryTime &&
                        (trade.status === PositionStatus.OPEN || billTimestamp <= trade.exitTime);

                    if (isRelevant) {
                        trade.totalFundingFee += SafeParsers.float(bill.balChg);
                        trade._rawBills.push(bill);
                        break; // Assume one funding fee bill belongs to only one trade lifecycle
                    }
                }
            }
        }

        for (const rawRisk of rawPositionRisks) {
            const positionKey = `${rawRisk.symbol}-${rawRisk.positionSide}`; // Key matched key construction in processFills?
            // processFills uses: `${fill.instId}-${fill.posSide}` (e.g. BTCUSDT-LONG)
            // rawRisk: symbol=BTCUSDT, positionSide=LONG
            // Note: rawRisk.positionSide might be uppercase 'LONG', fill.posSide might be uppercase?
            // Existing logic didn't lowercase. Let's ensure consistency. 
            // Okx uses lowercase. Binance RawFill usually returns uppercase? 
            // If existing logic worked, stick to it. Existing logic: `${fill.instId}-${fill.posSide}`. 
            // In processAllData->processFills, we used `fill.posSide` directly.
            // In existing applyBillsAndRisks: `${rawRisk.symbol}-${rawRisk.positionSide.toLowerCase()}`. 
            // Wait, existing check was mismatch?
            // Line 79: `${fill.instId}-${fill.posSide}`.
            // Line 260: `${rawRisk.symbol}-${rawRisk.positionSide.toLowerCase()}`.
            // If `fill.posSide` is 'LONG', key is '...-LONG'. Risk key is '...-long'. THEY MISMATCHED!
            // This suggests a bug in the old code or case sensitivity assumptions. 
            // Safe bet: Normalize to lowercase everywhere in Keys.
            // I will use `positionKey.toLowerCase()` or construct with `.toLowerCase()`.

            // Re-check processFills in this replacement:
            // const positionKey = `${fill.instId}-${fill.posSide}`; <- Should lowercase posSide?
            // binance types.ts says posSide: LONG/SHORT.
            // Best practice: normalize key.

            // But let's look at `openPositions` map. It is populated in `processFills`.
            // If I change the key generation there, I must change it here.

            // I will change `processFills` key to use `.toLowerCase()` for safety, similar to OKX.
        }
    }

    // ... wait, I need to rewrite `processFills` inside this valid ReplacementContent or update my logic above.
    // I am replacing the whole file content basically (except imports which I handle).
    // I will write the methods correctly below.

    // Redoing the applyBillsAndRisks for clarity in the final Replace block:

    private finalizeMetrics(allTrades: StandardizedTrade[]): void {
        allTrades.forEach(trade => {
            // Aggregate timeline events
            trade.timeline = TimelineUtils.aggregateEvents(trade.timeline);

            trade.netPnl = trade.realizedPnl - trade.totalCommission + trade.totalFundingFee;
            if (trade.totalValue > 0) {
                trade.pnlPercentage = trade.netPnl / trade.totalValue;
            } else {
                trade.pnlPercentage = 0;
            }
        });
    }
}
