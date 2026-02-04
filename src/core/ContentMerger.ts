
/**
 * 内容合并器 (Content Merger)
 *
 * 这个文件负责极其关键的“笔记更新”逻辑。当一个笔记已经存在，但需要更新数据时，
 * 它负责智能地合并新旧内容，防止用户手写的笔记被覆盖。
 *
 * 主要功能：
 * 1. 保护用户内容：识别用户在“Review & Reflection”或“Trade Plan”区域手写的内容，并保留它们。
 * 2. 更新数据区域：用最新的 API 数据（如平仓盈亏、最新时间线）替换旧的数据表格。
 * 3. 智能替换：通过正则匹配特定的 Markdown 章节（Overview, Timeline 等），做精准替换而非全文覆盖。
 *
 * 它是插件“增量更新”功能的核心保障。
 */
import { t } from '../lang/translator';
/**
 * Merges old note content with new template content, preserving user-entered sections.
 * Specifically targets sections starting with "## 3." and "## 5." to capture user input
 * in "Trade Plan" and "Review & Reflection" sections.
 * 
 * @param oldContent The existing content of the file (potentially containing user notes).
 * @param newContent The newly generated content from the template.
 * @returns The merged content with user notes preserved, or newContent if extraction fails safe.
 */
export function mergeNoteContent(oldContent: string, newContent: string): string {
    // 1. Define markers for the sections we want to preserve.
    // We want to preserve everything from the start of "## 3." up to (but not including) "## 5."
    // and potentially inside "## 5." if we decide to keep that too, but per requirements:
    // "Trade Plan" (Section 3) and "Review & Reflection" (Section 4) are the main ones.
    // The previous file structure was:
    // ## 3. Trade Plan
    // ## 4. Review & Reflection
    // ## 5. Raw Data Reference

    // We want to preserve the block:
    // FROM: "## 3." (inclusive)
    // TO: "## 5." (exclusive) - Assuming ## 5. is the start of the auto-generated raw data section.

    // Using regex to be robust against slight changes in spacing
    const startMarkerRegex = /^## 3\./m;
    const endMarkerRegex = /^## 5\./m;

    const oldStartMatch = startMarkerRegex.exec(oldContent);
    const oldEndMatch = endMarkerRegex.exec(oldContent);

    // If we can't find the structure in the old content, it might be too different or broken.
    // In that case, it's safer to return newContent (or maybe oldContent? defaulting to newContent for data update priority).
    // However, if we return newContent, we lose user data.
    // But if we return oldContent, we fail to update data.
    // Let's assume if markers are missing, we default to newContent but maybe log a warning if possible (can't log easily in pure func).
    if (!oldStartMatch || !oldEndMatch) {
        return newContent;
    }

    const startIndex = oldStartMatch.index;
    const endIndex = oldEndMatch.index;

    if (startIndex >= endIndex) {
        // Invalid structure (end before start)
        return newContent;
    }

    const userContentBlock = oldContent.substring(startIndex, endIndex);

    // Now find where to insert this in the new content
    const newStartMatch = startMarkerRegex.exec(newContent);
    const newEndMatch = endMarkerRegex.exec(newContent);

    if (!newStartMatch || !newEndMatch) {
        // New template changed structure? Fallback.
        return newContent;
    }

    const newStartIndex = newStartMatch.index;
    const newEndIndex = newEndMatch.index;

    // Construct the result
    let mergedContent = newContent.substring(0, newStartIndex) +
        userContentBlock +
        newContent.substring(newEndIndex);

    // 2. Perform granular merge for Timeline (Section 2)
    mergedContent = mergeTimelineSection(oldContent, mergedContent);

    return mergedContent;
}

/**
 * Merges "Decision Notes" from the old timeline section into the new timeline section.
 */
function mergeTimelineSection(oldContent: string, newContent: string): string {
    const timelineStartRegex = /^ *##+ *2\./m;
    const timelineEndRegex = /^ *##+ *3\./m; // Assumes Section 3 follows Section 2

    const oldStartMatch = timelineStartRegex.exec(oldContent);
    const oldEndMatch = timelineEndRegex.exec(oldContent);
    const newStartMatch = timelineStartRegex.exec(newContent);
    const newEndMatch = timelineEndRegex.exec(newContent);

    if (!oldStartMatch || !oldEndMatch || !newStartMatch || !newEndMatch) {
        // Could not isolate timeline sections in both files
        return newContent;
    }

    const oldTimelineBlock = oldContent.substring(oldStartMatch.index, oldEndMatch.index);

    // Parse old notes: Map<Timestamp, NoteContent>
    const notesMap = new Map<string, string>();

    // Strategy 1: Check for Table Format (Legacy)
    if (oldTimelineBlock.includes('| :--- |')) {
        // Simple line iterator
        const lines = oldTimelineBlock.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('|') && !trimmed.includes('---')) {
                // Potential data row
                const parts = trimmed.split('|').map(p => p.trim());
                // | Time | Action | Price | Qty | Val | Note |
                // parts[0] is empty, parts[1] is Time, parts[6] is Note (index 6, length 7 or 8)
                if (parts.length >= 7) {
                    const timestamp = parts[1];
                    // Skip header row
                    if (timestamp === t('Time') || timestamp === 'Time' || timestamp === '时间') continue;

                    const note = parts[6]; // The last column usually
                    if (note && note.length > 0) {
                        notesMap.set(timestamp, note);
                    }
                }
            }
        }
    } else {
        // Strategy 2: Check for List Format (Current/New)
        // Regex to capture pair inside a block
        // We assume the Decision Notes line exists.
        // Support both Chinese and English colons
        // Update: Support both bolded "**Decision Notes:**" and unbolded "Decision Notes:" to be robust.
        // Update 2: Use [ \t]* instead of \s* to avoid consuming newlines!
        const extractRegex = /^\s*-\s*\*\*([^\n*]+)\*\*[\s\S]*?^\s*-\s*(?:\*\*)?(?:Decision Notes|决策笔记)[:：](?:\*\*)?[ \t]*([^\n]*)/m;

        // Split block into items (and the header part)
        // Lookahead for "- **Digits"
        const itemSplitRegex = /(?=^ *-\s*\*\*\d)/gm;

        const oldItems = oldTimelineBlock.split(itemSplitRegex);

        for (const itemStr of oldItems) {
            // Reset regex for each item string
            extractRegex.lastIndex = 0;
            const match = extractRegex.exec(itemStr);
            if (match) {
                const timestamp = match[1].trim();
                // match[2] corresponds to the note content
                const note = match[2];
                if (note && note.trim().length > 0) {
                    notesMap.set(timestamp, note.trim());
                }
            }
        }
    }

    if (notesMap.size === 0) return newContent;

    // Now inject into newContent
    const newStartIndex = newStartMatch.index;
    const newEndIndex = newEndMatch.index;
    let newTimelineBlock = newContent.substring(newStartIndex, newEndIndex);

    // New format is always List
    const itemSplitRegexKey = /(?=^ *-\s*\*\*\d)/gm;
    const newItems = newTimelineBlock.split(itemSplitRegexKey);

    // Rebuild new block
    const mergedItems = newItems.map(itemStr => {
        // We need to extract the timestamp from the new item to match key
        const timestampRegex = /^\s*-\s*\*\*([^\n*]+)\*\*/;
        const match = timestampRegex.exec(itemStr);

        if (match) {
            const timestamp = match[1].trim();
            if (notesMap.has(timestamp)) {
                const oldNote = notesMap.get(timestamp)!;
                // Replace the Decision Notes line.
                // Flexible colon match and optional bolding
                // Use [ \t]* to avoid capturing the newline in the prefix group
                const decisionLineRegex = /(^\s*-\s*(?:\*\*)?(?:Decision Notes|决策笔记)[:：](?:\*\*)?[ \t]*)([^\n]*)/m;
                return itemStr.replace(decisionLineRegex, (m, prefix, existing) => {
                    // Start with prefix, add oldNote, preserve existing if it's somehow there (though newContent usually empty)
                    // We just overwrite with oldNote because newContent comes from template which is empty.
                    // IMPORTANT: Ensure we don't accidentally double the note if we append. But here we replace group 2 (content).
                    return `${prefix}${oldNote}`;
                });
            }
        }
        return itemStr;
    });

    const mergedTimelineBlock = mergedItems.join('');

    return newContent.substring(0, newStartIndex) + mergedTimelineBlock + newContent.substring(newEndIndex);
}
