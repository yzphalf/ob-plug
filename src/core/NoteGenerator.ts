/**
 * 笔记生成器 (Note Generator)
 *
 * 这个文件的核心任务是将结构化的交易数据（Object）转换成人类可读的 Markdown 文本。
 */
import { StandardizedTrade, TimelineEvent } from '../models/types';
import { t } from '../lang/translator';
import { formatDuration, formatTimestamp } from '../utils/LocalTimeUtils';

/**
 * 根据 StandardizedTrade 对象生成 Obsidian 笔记的 Markdown 字符串。
 * @param trade 经过处理和标准化的交易对象。
 * @returns 格式化的 Markdown 字符串。
 */
export function generateObsidianNote(trade: StandardizedTrade): string {
  // --- 1. 数据准备 ---
  const durationFormatted = formatDuration(trade.durationMs);
  const pnlPercentageFormatted = (trade.pnlPercentage * 100).toFixed(2);

  const tagsYaml = trade.tags && trade.tags.length > 0
    ? '\n' + trade.tags.map(tag => `  - ${tag}`).join('\n')
    : '';

  // Helper for Cost Display
  // For Inverse (USD), Cost is in Coins (BTC etc), so use pnlCurrency and more decimals.
  // For Linear (USDT), Cost is in USDT, use 2 decimals.
  const isInverse = trade.valueCurrency === 'USD';
  const costDecimals = isInverse ? 6 : 2;
  const costCurrency = isInverse ? (trade.pnlCurrency || 'BTC') : (trade.valueCurrency || t('USDT'));

  // Helper for Size Unit
  // Inverse: Size is in USD.
  // Linear: Size is in Coins (Base Currency).
  let sizeUnit = '';
  if (isInverse) {
    sizeUnit = 'USD';
  } else {
    // Attempt to extract base currency from symbol (e.g. BTC-USDT-SWAP -> BTC)
    const parts = trade.symbol.split('-');
    if (parts.length > 0) {
      sizeUnit = parts[0];
    }
  }

  // --- 2. 构建时间线 ---
  const timelineRows = trade.timeline.map(event => {
    // Inverse Contract (USD-Margin) Handling
    // If valueCurrency is 'USD', then Size is already in USD (Nominal Value).
    // If valueCurrency is 'USDT', then Size is in Coins, so Nominal Value = Size * Price.
    let eventValue = '';
    if (isInverse) {
      eventValue = event.size.toFixed(2);
    } else {
      eventValue = (event.price * event.size).toFixed(2);
    }

    const actionLabel = t(event.action || 'UNKNOWN');

    return `- **${formatTimestamp(event.timestamp)}** - ${actionLabel}
  - ${t('Price')}: ${event.price} | ${t('Quantity')}: ${event.size} ${sizeUnit} | ${t('Fee')}: ${event.fee} ${event.feeCcy} | ${t('Nominal Value')}: ${eventValue}
  - ${t('Decision Notes')}: ${event.notes || ''}`;
  }).join('\n');

  const timelineContent = timelineRows;

  // --- 3. 构建 Markdown 模板 ---
  return `---
id: ${trade.id}
symbol: ${trade.symbol}
tags:
  - ${t('trade')}
  - ${t('futures')}${tagsYaml}
---

# ${t('Trade Review: ')}${trade.symbol}

## 1. ${t('Overview')}

| ${t('Item')} | ${t('Content')} |
| :--- | :--- |
| **${t('Symbol')}** | ${trade.symbol} |
| **${t('Direction')}** | ${trade.direction === 'long' ? t('Long') : t('Short')} |
| **${t('Status')}** | ${trade.status === 'closed' ? t('Closed') : (trade.status === 'liquidated' ? t('Liquidated') : t('Open'))} |
| **${t('Total Position Size')}** | ${trade.totalSize.toFixed(4)} ${sizeUnit} |
| **${t('Total Cost')}** | ${trade.totalValue.toFixed(costDecimals)} ${costCurrency} |
| **${t('Holding Duration')}** | ${durationFormatted} |
| **${t('Trading PnL')}** | ${trade.realizedPnl.toFixed(4)} ${trade.pnlCurrency || t('USDT')} |
| **${t('Funding Fee')}** | ${trade.totalFundingFee.toFixed(4)} ${trade.pnlCurrency || t('USDT')} |
| **${t('Trading Fee')}** | ${trade.totalCommission.toFixed(4)} ${trade.feeCurrency || t('USDT')} |
| **${t('Net PnL')}** | **${trade.netPnl.toFixed(4)} ${trade.pnlCurrency || t('USDT')} (${pnlPercentageFormatted}%)** |

## 2. ${t('Timeline')}
${timelineContent}

## 3. ${t('Trade Plan (Plan)')}
> ${t('Review your initial trade plan here, comparing it with actual execution.')}

| ${t('Item')} | ${t('Planned Content')} |
| :--- | :--- |
| **${t('Strategy/Basis')}** | |
| **${t('Entry Point')}** | |
| **${t('Stop Loss')}** | |
| **${t('Take Profit Target')}** | |
| **${t('Risk/Reward Ratio')}** | |

## 4. ${t('Review & Reflection (Review & Reflection)')}

**${t('What went well:')}**
- 

**${t('Areas for improvement:')}**
- 

**${t('Emotions & Psychology:')}**
- 

**${t('Lessons Learned:')}**
- 

## 5. ${t('Raw Data Reference')}
<details>
<summary>${t('Click to expand for raw JSON data')}</summary>

### ${t('Raw Fills')}
\`\`\`json
${JSON.stringify(trade._rawFills, null, 2)}
\`\`\`

### ${t('Raw Bills')}
\`\`\`json
${JSON.stringify(trade._rawBills, null, 2)}
\`\`\`

</details>

`;
}

/**
 * 生成市场观察笔记
 */
export function generateAnalysisNote(symbol: string, price: number, note: string): string {
  const timestamp = Date.now();
  const dateStr = formatTimestamp(timestamp);

  return `---
type: analysis
symbol: ${symbol}
price: ${price}
date: ${timestamp}
tags:
  - ${t('analysis')}
  - ${symbol}
---

# ${t('Market Analysis')}: ${symbol}

**${t('Time')}**: ${dateStr}
**${t('Price')}**: ${price}

## ${t('Thoughts')}
${note}
`;
}
