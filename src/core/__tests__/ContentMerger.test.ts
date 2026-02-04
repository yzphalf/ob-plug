
import { describe, it, expect } from 'vitest';
import { mergeNoteContent } from '../ContentMerger';

describe('ContentMerger', () => {
    const templateBefore = `
# Trade Review: BTCUSDT
## 1. Overview
...
## 2. Timeline
...
`;
    const templateAfter = `
## 5. Raw Data Reference
...
`;

    const userSection = `
## 3. Trade Plan (Plan)
My custom plan content.

## 4. Review & Reflection (Review & Reflection)
My custom review content.
`;

    const defaultSection = `
## 3. Trade Plan (Plan)
> Review your initial trade plan here...

| Item | Planned Content |
| :--- | :--- |
| **Strategy/Basis** | |

## 4. Review & Reflection (Review & Reflection)
**What went well:**
- 
`;

    it('should preserve user content when updating', () => {
        const oldContent = templateBefore + userSection + templateAfter;
        // New content has default blank sections
        const newContent = templateBefore + defaultSection + templateAfter;

        const result = mergeNoteContent(oldContent, newContent);

        expect(result).toContain('My custom plan content');
        expect(result).toContain('My custom review content');
        expect(result).not.toContain('> Review your initial trade plan here');
    });

    it('should return new content if markers are missing in old content', () => {
        const oldContent = "Some random text without markers";
        const newContent = templateBefore + defaultSection + templateAfter;

        const result = mergeNoteContent(oldContent, newContent);

        expect(result).toBe(newContent);
    });

    it('should return new content if markers are misplaced in old content', () => {
        // End before Start
        const oldContent = `
## 5. Raw Data Reference
## 3. Trade Plan
`;
        const newContent = templateBefore + defaultSection + templateAfter;

        const result = mergeNoteContent(oldContent, newContent);

        expect(result).toBe(newContent);
    });

    it('should handle template changes gracefully (fallback to new content if markers missing in new)', () => {
        const oldContent = templateBefore + userSection + templateAfter;
        // New content missing markers
        const newContent = "New content without any markers";

        const result = mergeNoteContent(oldContent, newContent);

        expect(result).toBe(newContent);
    });

    it('should preserve Decision Notes in timeline', () => {
        // Old content with user note
        const oldTimeline = `
## 2. Timeline
- **2025/12/27 12:50:43**
  - **Action:** Open
  - **Price:** 100.0
  - **Decision Notes:** My secret reason
- **2025/12/27 13:00:00**
  - **Decision Notes:** Another note
## 3. Trade Plan
`;

        // New content with updated price but empty note
        const newTimeline = `
## 2. Timeline
- **2025/12/27 12:50:43**
  - **Action:** Open
  - **Price:** 101.5
  - **Decision Notes:**
- **2025/12/27 13:00:00**
  - **Decision Notes:**
## 3. Trade Plan
`;
        // We need full template context for mergeNoteContent validation because it checks ## 3 and ## 5 too.
        // But the timeline logic is inside. Let's construct minimal full docs.
        const fullOld = oldTimeline + `## 5. Raw\n`;
        const fullNew = newTimeline + `## 5. Raw\n`;

        const result = mergeNoteContent(fullOld, fullNew);

        expect(result).toContain('My secret reason'); // Note preserved
        expect(result).toContain('101.5'); // Price updated
        expect(result).toContain('Another note');
    });
});
