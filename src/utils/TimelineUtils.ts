import { TimelineEvent } from '../models/types';
import { SafeParsers } from '../infrastructure/okx/SafeParsers'; // Re-use safe parsers or move it to a shared place? Better move SafeParsers to shared too.
// For now, let's keep SafeParsers where it is and import it, or just use basic logic since aggregation deals with already parsed numbers mostly.
// Actually, let's just use standard math here.

/**
 * 时间线工具 (Timeline Utils)
 * 
 * 提供处理 TimelineEvent 的通用算法，如聚合、排序等。
 */
export class TimelineUtils {

    /**
     * 聚合时间线事件
     * 合并同一时间点或极短时间内的连续动作
     * 
     * @param executionEvents 原始事件列表
     * @param mergeWindowMs 合并窗口 (默认 60s)
     * @returns 聚合后的事件列表
     */
    public static aggregateEvents(executionEvents: TimelineEvent[], mergeWindowMs: number = 60000): TimelineEvent[] {
        if (!executionEvents || executionEvents.length < 2) return executionEvents;

        // 1. 拷贝并排序 (避免副作用)
        const sortedEvents = [...executionEvents].sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return (a.tradeId || '').localeCompare(b.tradeId || '');
        });

        const aggregated: TimelineEvent[] = [];
        let currentGroup: TimelineEvent[] = [sortedEvents[0]];

        for (let i = 1; i < sortedEvents.length; i++) {
            const current = sortedEvents[i];
            const prev = currentGroup[currentGroup.length - 1];

            const isSameAction = current.action === prev.action;
            const isWithinWindow = (current.timestamp - prev.timestamp) < mergeWindowMs;

            // 特殊逻辑：Opening 序列合并 (Open -> Add)
            const isOpenSequence = (prev.action === 'OPEN' && current.action === 'ADD') ||
                (prev.action === 'ADD' && current.action === 'OPEN');

            // 特殊逻辑：Closing 序列合并 (Reduce -> Close)
            const isCloseSequence = (prev.action === 'REDUCE' && current.action === 'CLOSE') ||
                (prev.action === 'CLOSE' && current.action === 'REDUCE');

            if (isWithinWindow && (isSameAction || isOpenSequence || isCloseSequence)) {
                currentGroup.push(current);
            } else {
                aggregated.push(this.mergeGroup(currentGroup));
                currentGroup = [current];
            }
        }
        aggregated.push(this.mergeGroup(currentGroup));

        return aggregated;
    }

    /**
     * 合并一组事件为一个事件
     */
    private static mergeGroup(group: TimelineEvent[]): TimelineEvent {
        if (group.length === 1) return group[0];

        const first = group[0];

        let totalVal = 0;
        let totalSz = 0;
        let totalFee = 0;

        group.forEach(e => {
            totalVal += e.price * e.size;
            totalSz += e.size;
            totalFee += (e.fee || 0);
        });

        const avgPrice = totalSz > 0 ? totalVal / totalSz : 0;

        // 决定合并后的动作类型
        let finalAction = first.action;
        if (group.some(e => e.action === 'OPEN')) finalAction = 'OPEN';
        else if (group.some(e => e.action === 'CLOSE')) finalAction = 'CLOSE';

        return {
            ...first,
            timestamp: first.timestamp, // 使用第一个的时间
            action: finalAction,
            price: avgPrice,
            size: totalSz,
            fee: totalFee,
            tradeId: group.map(e => e.tradeId).filter(Boolean).join(','),
            orderId: group.map(e => e.orderId).filter(Boolean).join(','),
            notes: group.map(e => e.notes).filter(Boolean).join('; ')
        };
    }
}
