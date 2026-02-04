/**
 * K线图视图 (K-Line Chart View)
 *
 * 这是 Obsidian 的一个自定义视图组件 (ItemView)，负责渲染漂亮的 TradingView 风格 K线图。
 *
 * 主要功能：
 * 1. 绘图引擎：集成 `lightweight-charts` 库，绘制高性能的蜡烛图。
 * 2. 交互控制：提供顶部工具栏，调节“交易对”和“K线周期”（如 15m, 4h, 1D）。
 * 3. 交易复盘：
 *    - 在 K 线图上打点：用箭头和圆点标记出开仓、加仓、平仓的位置。
 *    - 智能预加载：自动向前多加载 1000 根数据，确保均线计算准确。
 * 4. 指标渲染：根据设置动态画出用户配置的 MA/EMA 均线。
 * 5. 自动聚焦：打开图表时，自动缩放到交易发生的那个时间段。
 */
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { createChart, IChartApi, ISeriesApi, ChartOptions, CandlestickSeriesOptions, UTCTimestamp, LogicalRange, IPriceLine, PriceLineOptions, LineSeriesOptions, ColorType, LineStyle, SeriesMarkerPosition, DeepPartial } from "lightweight-charts";
import type MyPlugin from "../core/main";
import { MyPluginSettings } from "../infrastructure/obsidian/settings";
import { TimelineEvent } from '../models/types';
import { t } from '../lang/translator'; // Import t for translation


export const K_LINE_VIEW_TYPE = "k-line-view";


// Define theme options
const LIGHT_THEME_CHART_OPTIONS: DeepPartial<ChartOptions> = {
    layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#333',
        fontSize: 12,
        fontFamily: "'Inter', sans-serif",
    },
    grid: {
        vertLines: { style: LineStyle.Solid, visible: true, color: 'rgba(240, 240, 240, 1)' },
        horzLines: { style: LineStyle.Solid, visible: true, color: 'rgba(240, 240, 240, 1)' },
    },
};

const DARK_THEME_CHART_OPTIONS: DeepPartial<ChartOptions> = {
    layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#e0e0e0',
        fontSize: 12,
        fontFamily: "'Inter', sans-serif",
    },
    grid: {
        vertLines: { style: LineStyle.Solid, visible: true, color: 'rgba(50, 50, 50, 1)' },
        horzLines: { style: LineStyle.Solid, visible: true, color: 'rgba(50, 50, 50, 1)' },
    },
};

// Define theme options for Candlestick Series
const CANDLE_SERIES_LIGHT_OPTIONS: DeepPartial<CandlestickSeriesOptions> = {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    wickVisible: true,
    borderVisible: true,
    borderColor: '#26a69a', // Default fallback
    wickColor: '#26a69a',   // Default fallback
};

const CANDLE_SERIES_DARK_OPTIONS: DeepPartial<CandlestickSeriesOptions> = {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    wickVisible: true,
    borderVisible: true,
    borderColor: '#26a69a', // Default fallback
    wickColor: '#26a69a',   // Default fallback
};

export class KLineView extends ItemView {
    private chart: IChartApi | null = null;
    private candleSeries: ISeriesApi<"Candlestick"> | null = null;
    private customIndicatorSeriesMap: Map<string, ISeriesApi<"Line">> = new Map();
    private priceLines: IPriceLine[] = [];
    // private apiClient: BinanceApiClient; // Removed
    private plugin: MyPlugin;
    private settings: MyPluginSettings;
    private currentSymbol: string | null = null;
    private currentInterval: string = '30m'; // Default to 30m
    private supportedIntervals: string[] = ['30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    private tradeEvents: Partial<TimelineEvent>[] = [];


    constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {


        super(leaf);
        this.plugin = plugin;
        this.settings = plugin.settings;
        // this.apiClient = new BinanceApiClient(this.settings.binanceProxyUrl, requestUrl); // Removed

    }

    getViewType() {
        return K_LINE_VIEW_TYPE;
    }

    getIcon() {
        return "tradingview-icon";
    }

    getDisplayText() {
        return this.currentSymbol ? t('{{symbol}} K-Line').replace('{{symbol}}', this.currentSymbol) : t('K-Line Chart');
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();

        const controlsContainer = container.createDiv({ cls: "kline-controls" });
        controlsContainer.setCssProps({
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "10px",
            gap: "10px",
            borderBottom: "1px solid var(--background-modifier-border)",
            flexWrap: "wrap",
        });

        // Symbol display (as text)
        const symbolDisplay = controlsContainer.createDiv({ cls: "kline-symbol-display" });
        symbolDisplay.setCssProps({
            fontSize: "1.2em",
            fontWeight: "bold",
        });


        if (!this.currentSymbol) {
            const symbols = await this.plugin.symbolService.getSymbolsFromVault();
            if (symbols.length > 0) {
                this.currentSymbol = symbols[0];
            }
        }
        this.updateDisplayText();

        // Interval selection
        const intervalSelect = controlsContainer.createEl("select", { cls: "kline-interval-select" });
        intervalSelect.setCssProps({
            padding: "8px",
            borderRadius: "4px",
            border: "1px solid var(--background-modifier-border)",
            backgroundColor: "var(--background-primary)",
            color: "var(--text-normal)",
            cursor: "pointer",
            marginLeft: "10px",
            position: "relative",
            top: "-3px",
        });

        this.supportedIntervals.forEach(interval => {
            const option = intervalSelect.createEl("option", { value: interval, text: interval });
            if (interval === this.currentInterval) {
                option.selected = true;
            }
        });

        intervalSelect.onchange = async () => {
            const newInterval = intervalSelect.value;
            if (newInterval && newInterval !== this.currentInterval) {
                this.currentInterval = newInterval;
                await this.loadDataForSymbol();
            }
        };

        const wrapper = container.createEl("div");
        wrapper.style.position = 'absolute';
        wrapper.style.top = '50px'; // Adjust top to account for smaller controls bar
        wrapper.style.bottom = '0';
        wrapper.style.left = '0';
        wrapper.style.right = '0';

        this.chart = createChart(wrapper, {
            width: wrapper.clientWidth,
            height: wrapper.clientHeight,
            timeScale: { timeVisible: true, secondsVisible: false }
        });

        this.candleSeries = this.chart.addCandlestickSeries();

        this.applyThemeColors();

        this.registerEvent(
            this.app.workspace.on('css-change', () => this.applyThemeColors())
        );

        this.registerEvent(
            this.app.workspace.on('resize', () => {
                if (this.chart) {
                    this.chart.resize(wrapper.clientWidth, wrapper.clientHeight);
                }
            })
        );

        // Listen for cache file updates via Service
        this.plugin.kLineDataService.onDataUpdate(async (symbol, interval) => {
            if (symbol === this.currentSymbol && interval === this.currentInterval) {
                console.log('Cache updated, reloading chart...');
                await this.loadDataForSymbol();
            }
        });

        // Load initial data
        await this.loadDataForSymbol();
    }

    async setContext(symbol: string, tradeEvents?: Partial<TimelineEvent>[], interval?: string) {
        const newTradeEvents = tradeEvents || [];

        // Deep comparison to prevent re-rendering for the same context
        if (
            symbol === this.currentSymbol &&
            interval === this.currentInterval &&
            JSON.stringify(newTradeEvents) === JSON.stringify(this.tradeEvents)
        ) {
            console.log("KLineView.setContext: Skipping render, context is the same.");
            return;
        }

        console.log("KLineView.setContext called with symbol:", symbol, "tradeEvents:", newTradeEvents, "interval:", interval);
        this.currentSymbol = symbol;
        this.tradeEvents = newTradeEvents;

        if (interval && interval !== this.currentInterval && this.supportedIntervals.includes(interval)) {
            this.currentInterval = interval;
            const intervalSelect = this.containerEl.querySelector('.kline-interval-select') as HTMLSelectElement;
            if (intervalSelect) {
                intervalSelect.value = interval;
            }
        }

        this.updateDisplayText();

        await this.loadDataForSymbol();
    }

    private updateDisplayText() {
        // Update the leaf title
        const newTitle = this.currentSymbol ? t('{{symbol}} K-Line').replace('{{symbol}}', this.currentSymbol) : t('K-Line Chart');
        this.leaf.setViewState({
            ...this.leaf.getViewState(),
            state: { ...this.leaf.getViewState().state, displayText: newTitle }
        });

        // Update the symbol display div
        const symbolDisplay = this.containerEl.querySelector('.kline-symbol-display');
        if (symbolDisplay) {
            symbolDisplay.textContent = this.currentSymbol || '---';
        }
    }

    private applyThemeColors() {
        if (!this.chart || !this.candleSeries) return;

        const isDark = document.body.hasClass('theme-dark');

        this.chart.applyOptions(isDark ? DARK_THEME_CHART_OPTIONS : LIGHT_THEME_CHART_OPTIONS);
        this.candleSeries.applyOptions(isDark ? CANDLE_SERIES_DARK_OPTIONS : CANDLE_SERIES_LIGHT_OPTIONS);



        this.customIndicatorSeriesMap.forEach((series, id) => {
            const customIndicatorSetting = this.settings.customIndicators.find(ind => ind.id === id);
            if (customIndicatorSetting) {
                series.applyOptions({ color: customIndicatorSetting.color } as LineSeriesOptions);
            }
        });
    }

    private intervalToMs(interval: string): number {
        const value = parseInt(interval.slice(0, -1));
        const unit = interval.slice(-1);
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            case 'M': return value * 30 * 24 * 60 * 60 * 1000; // Approximation
            default: return 15 * 60 * 1000;
        }
    }

    private async loadDataForSymbol() {
        if (!this.candleSeries || !this.currentSymbol) return;

        // Clear previous markers and price lines
        this.candleSeries.setMarkers([]);
        this.clearIndicatorSeries();

        try {
            const analysisEvents = await this.plugin.analysisService.getAnalysisRecords(this.currentSymbol);
            const mergedEvents = [...this.tradeEvents, ...analysisEvents];

            // 1. Determine Time Range with Buffer (Smart Pre-loading)
            let earliestTs = Date.now();
            let latestTs = Date.now();

            if (mergedEvents.length > 0) {
                const timestamps = mergedEvents.map(e => e.timestamp || Date.now());
                earliestTs = Math.min(...timestamps);
                latestTs = Math.max(...timestamps);
            } else {
                // Default to last 24 hours if no events
                earliestTs = Date.now() - 24 * 60 * 60 * 1000;
            }

            const intervalMs = this.intervalToMs(this.currentInterval);
            const bufferCandles = 1000; // 1000 candles buffer for accurate EMA200
            const bufferMs = bufferCandles * intervalMs;

            const fetchStartTime = earliestTs - bufferMs;
            // Fetch until "now" or at least covering the trade + some future context
            // Let's fetch until now to be safe and give context
            const fetchEndTime = Date.now();

            console.log(`Smart Loading: Trade range [${new Date(earliestTs).toISOString()}, ${new Date(latestTs).toISOString()}]`);
            console.log(`Fetching from ${new Date(fetchStartTime).toISOString()} (Buffer: ${bufferCandles} candles)`);

            // 2. Load Data from Cache (with background sync)
            const cachedData = await this.plugin.kLineDataService.getCachedKLines(this.currentSymbol, this.currentInterval, fetchStartTime);

            if (!cachedData || cachedData.length === 0) {
                // Fallback or just empty
                // new Notice(t('Loading data...'), 2000); // Removed per user request
            }

            const chartData = cachedData.map(c => ({
                time: (c[0] / 1000) as UTCTimestamp,
                open: c[1],
                high: c[2],
                low: c[3],
                close: c[4]
            }));

            this.candleSeries.setData(chartData);
            console.log(`[DEBUG] Chart data set with ${chartData.length} bars.`);

            // 3. Load and display custom indicators
            this.settings.customIndicators.forEach(indicator => {
                if (indicator.enabled && indicator.period > 0) {
                    let indicatorData: any[] = [];
                    if (indicator.type === 'MA') {
                        indicatorData = this.plugin.indicatorService.calculateMA(chartData, indicator.period);
                    } else if (indicator.type === 'EMA') {
                        indicatorData = this.plugin.indicatorService.calculateEMA(chartData, indicator.period);
                    }

                    let series = this.customIndicatorSeriesMap.get(indicator.id);
                    if (!series) {
                        series = this.chart?.addLineSeries({
                            title: indicator.title,
                            color: indicator.color,
                            lineWidth: 1,
                            lastValueVisible: true,
                            priceLineVisible: false,
                        });
                        if (series) {
                            series.setData(indicatorData);
                            this.customIndicatorSeriesMap.set(indicator.id, series);
                        }
                    } else {
                        series.setData(indicatorData);
                    }
                }
            });

            // 4. Highlight Events & Auto-Zoom
            if (mergedEvents.length > 0) {
                this.highlightTradeEvents(mergedEvents, chartData);
            } else {
                // Clear price lines if no events
                this.priceLines.forEach(line => this.candleSeries?.removePriceLine(line));
                this.priceLines = [];
                // If no events, just show the latest data
                this.chart?.timeScale().scrollToPosition(0, false);
            }

        } catch (error) {
            console.error(t('Failed to load K-line data:'), error);
            new Notice(t('Failed to load data for {{symbol}}. Check proxy or symbol.').replace('{{symbol}}', this.currentSymbol), 7000);
        }
    }

    private findClosestBarIndex(chartData: any[], targetTimestamp: number): number {
        let low = 0;
        let high = chartData.length - 1;
        let closestIndex = -1;
        let minDiff = Infinity;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const barTime = chartData[mid].time;
            const diff = Math.abs(barTime - targetTimestamp);

            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = mid;
            }

            if (barTime < targetTimestamp) {
                low = mid + 1;
            } else if (barTime > targetTimestamp) {
                high = mid - 1;
            } else {
                return mid; // Exact match
            }
        }
        return closestIndex;
    }

    private highlightTradeEvents(events: Partial<TimelineEvent>[], chartData: any[]) {
        if (!this.chart || !this.candleSeries || chartData.length === 0) return;

        // First, clear any existing price lines from the chart
        this.priceLines.forEach(line => this.candleSeries?.removePriceLine(line));

        const newPriceLines: IPriceLine[] = [];
        const markers = [];
        let firstBarIndex = Infinity; // Initialize to Infinity
        let lastBarIndex = -1;

        const sortedEvents = [...events].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        for (const event of sortedEvents) {
            if (!event.timestamp || !event.price || !event.action) continue;

            let markerColor = '#9B7DFF'; // Default color for unknown actions
            let shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square' = 'circle';
            let position: 'aboveBar' | 'belowBar' | 'inBar' = 'inBar';

            switch (event.action) {
                case 'OPEN':
                    markerColor = '#26a69a'; // Green
                    shape = 'arrowUp';
                    position = 'belowBar';
                    break;
                case 'ADD':
                    markerColor = '#26a69a'; // Green
                    shape = 'circle';
                    position = 'belowBar';
                    break;
                case 'REDUCE':
                    markerColor = '#ef5350'; // Red
                    shape = 'square';
                    position = 'aboveBar';
                    break;
                case 'CLOSE':
                    markerColor = '#ef5350'; // Red
                    shape = 'arrowDown';
                    position = 'aboveBar';
                    break;
                case 'MARKET_ANALYSIS':
                    markerColor = '#2962FF'; // Blue
                    shape = 'circle';
                    position = 'aboveBar';
                    break;
            }

            // Create Price Line
            const priceLineOptions: PriceLineOptions = {
                price: event.price,
                color: markerColor,
                lineWidth: 1,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: t('{{action}} @ {{price}}')
                    .replace('{{action}}', t(event.action || ''))
                    .replace('{{price}}', event.price.toString()),
                lineVisible: true,
                axisLabelColor: '',
                axisLabelTextColor: '',
            };
            if (this.candleSeries) {
                const priceLine = this.candleSeries.createPriceLine(priceLineOptions);
                newPriceLines.push(priceLine);
            }

            // Find closest bar for marker using binary search
            const tradeTimeInSeconds = event.timestamp / 1000;
            const closestBarIndex = this.findClosestBarIndex(chartData, tradeTimeInSeconds);

            if (closestBarIndex !== -1) {
                const closestBar = chartData[closestBarIndex];
                const barTime = closestBar.time as UTCTimestamp;

                // Verify if closest bar is actually close enough (e.g. within 2 intervals)
                const timeDiff = Math.abs((closestBar.time as number) - tradeTimeInSeconds);
                const intervalSec = this.intervalToMs(this.currentInterval) / 1000;

                if (timeDiff <= intervalSec * 2) {
                    markers.push({
                        time: barTime,
                        position: position as SeriesMarkerPosition,
                        color: markerColor,
                        shape: shape,
                        text: (t('{{action}} at {{time}}')
                            .replace('{{action}}', t(event.action || ''))
                            .replace('{{time}}', new Date(event.timestamp).toLocaleTimeString())) + (event.action === 'MARKET_ANALYSIS' && event.notes ? ': ' + event.notes : ''),
                    });

                    if (closestBarIndex < firstBarIndex) firstBarIndex = closestBarIndex;
                    if (closestBarIndex > lastBarIndex) lastBarIndex = closestBarIndex;
                } else {
                    console.warn(`[KLineView] Trade event at ${new Date(event.timestamp).toISOString()} is too far from closest bar at ${new Date((closestBar.time as number) * 1000).toISOString()} (diff: ${timeDiff}s)`);
                }
            }
        }

        this.priceLines = newPriceLines;

        if (markers.length > 0) {
            this.candleSeries.setMarkers(markers);
        } else if (events.length > 0) {
            // new Notice(t('Detailed K-Line data for this trade is missing or has not loaded yet.')); // Removed per user request
        }

        // Auto Zoom to Range using Timestamps
        if (markers.length > 0) {
            const timestamps = markers.map(m => m.time as number);
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);

            const intervalSec = this.intervalToMs(this.currentInterval) / 1000;
            const margin = intervalSec * 20;

            this.chart.timeScale().setVisibleRange({
                from: (minTime - margin) as UTCTimestamp,
                to: (maxTime + margin) as UTCTimestamp,
            });
        } else if (events.length > 0) {
            const timestamps = events.map(e => (e.timestamp || Date.now()) / 1000);
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);

            const margin = 3600 * 4;

            this.chart.timeScale().setVisibleRange({
                from: (minTime - margin) as UTCTimestamp,
                to: (maxTime + margin) as UTCTimestamp,
            });
        } else {
            this.chart.timeScale().scrollToPosition(0, false);
        }
    }

    private clearIndicatorSeries() {
        this.customIndicatorSeriesMap.forEach(series => {
            this.chart?.removeSeries(series);
        });
        this.customIndicatorSeriesMap.clear();
    }

    async onClose() {
        this.clearIndicatorSeries();
        if (this.chart) {
            this.chart.remove();
            this.chart = null;
        }
    }
}
