/**
 * 本地时间工具类 (Local Time Utils)
 *
 * 提供统一的时间格式化功能，确保多语言环境下的时间显示一致性。
 */
import { t, getCurrentLanguage } from '../lang/translator';

/**
 * 将毫秒时长格式化为可读的字符串 (例如 "1天 2小时 30分钟")
 */
export function formatDuration(ms: number): string {
    if (ms <= 0) return t('0 minutes');
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days} ${t('day')}${days > 1 ? t('s') : ''}`);
    if (hours % 24 > 0) parts.push(`${hours % 24} ${t('hour')}${hours % 24 > 1 ? t('s') : ''}`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60} ${t('minute')}${minutes % 60 > 1 ? t('s') : ''}`);

    if (parts.length > 0) return parts.join(' ');
    // Handle cases less than a minute but > 0
    return t('<1 minute');
}

/**
 * 将时间戳格式化为可读的日期时间字符串
 */
export function formatTimestamp(timestamp: number): string {
    if (timestamp <= 0) return t('N/A');
    const lang = getCurrentLanguage();
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';

    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    };

    if (lang === 'zh') {
        options.timeZone = 'Asia/Shanghai';
    }

    return new Date(timestamp).toLocaleString(locale, options);
}
