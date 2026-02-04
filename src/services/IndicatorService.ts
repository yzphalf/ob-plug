import { UTCTimestamp } from "lightweight-charts";

export interface ChartDataPoint {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface IndicatorPoint {
    time: UTCTimestamp;
    value: number | undefined;
}

/**
 * 指标计算服务 (Indicator Service)
 * 
 * 负责处理各种技术指标的计算逻辑，将纯计算从 UI 组件中剥离。
 */
export class IndicatorService {

    /**
     * 计算简单移动平均线 (MA)
     * @param data K线数据数组
     * @param period 周期
     */
    public calculateMA(data: ChartDataPoint[], period: number): IndicatorPoint[] {
        const maData: IndicatorPoint[] = [];
        for (let i = 0; i < data.length; i++) {
            if (i >= period - 1) {
                const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val.close, 0);
                maData.push({ time: data[i].time, value: sum / period });
            } else {
                maData.push({ time: data[i].time, value: undefined });
            }
        }
        return maData;
    }

    /**
     * 计算指数移动平均线 (EMA)
     * @param data K线数据数组
     * @param period 周期
     */
    public calculateEMA(data: ChartDataPoint[], period: number): IndicatorPoint[] {
        const emaData: IndicatorPoint[] = [];
        const multiplier = 2 / (period + 1);
        let ema = 0;

        for (let i = 0; i < data.length; i++) {
            if (i === 0) {
                ema = data[i].close;
            } else if (i < period - 1) {
                emaData.push({ time: data[i].time, value: undefined });
                continue;
            }

            if (i === period - 1) {
                const sum = data.slice(0, period).reduce((acc, val) => acc + val.close, 0);
                ema = sum / period;
            } else {
                ema = (data[i].close - ema) * multiplier + ema;
            }
            emaData.push({ time: data[i].time, value: ema });
        }
        return emaData;
    }
}
