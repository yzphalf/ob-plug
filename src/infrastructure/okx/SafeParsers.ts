/**
 * 安全解析工具 (Safe Parsers)
 * 
 * 提供健壮的数值解析功能，避免 NaN 导致的逻辑错误。
 */

export const SafeParsers = {
    /**
     * 安全解析整数
     * @param value 字符串值
     * @param fallback 解析失败时的默认值 (默认为 0)
     */
    integer: (value: string | number | undefined, fallback: number = 0): number => {
        if (value === undefined || value === null) return fallback;
        const parsed = parseInt(String(value), 10);
        return isNaN(parsed) ? fallback : parsed;
    },

    /**
     * 安全解析浮点数
     * @param value 字符串值
     * @param fallback 解析失败时的默认值 (默认为 0.0)
     */
    float: (value: string | number | undefined, fallback: number = 0.0): number => {
        if (value === undefined || value === null) return fallback;
        const parsed = parseFloat(String(value));
        return isNaN(parsed) ? fallback : parsed;
    }
};
