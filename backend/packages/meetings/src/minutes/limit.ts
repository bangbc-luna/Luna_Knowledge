import { formatTimelineForPrompt, type Speaker, type TimelineEntry } from './timeline.js';

export const TIMELINE_TRUNCATION_MARKER = '[... phần giữa bản ghi đã được lược bớt vì quá dài ...]';

export interface LimitedTimeline {
  text: string;
  entries: TimelineEntry[];
  truncated: boolean;
}

export function limitTimeline(
  timeline: { speakers: Speaker[]; entries: TimelineEntry[] },
  maxChars: number,
): LimitedTimeline {
  const full = formatTimelineForPrompt(timeline);
  if (full.length <= maxChars) return { text: full, entries: timeline.entries, truncated: false };

  const lines = full.split('\n');
  const budget = Math.max(0, maxChars - TIMELINE_TRUNCATION_MARKER.length - 2);
  const headBudget = Math.floor(budget / 2);

  let head = 0;
  let headUsed = 0;
  while (head < lines.length && headUsed + lines[head]!.length + 1 <= headBudget) {
    headUsed += lines[head]!.length + 1;
    head++;
  }

  let headLine: string | null = null;
  if (head === 0 && lines.length > 0) {
    headLine = lines[0]!.slice(0, Math.max(0, headBudget - 1));
    head = 1;
    headUsed = headLine.length + 1;
  }

  const tailBudget = budget - headUsed;
  let tail = 0;
  let tailUsed = 0;
  while (
    tail < lines.length - head &&
    tailUsed + lines[lines.length - 1 - tail]!.length + 1 <= tailBudget
  ) {
    tailUsed += lines[lines.length - 1 - tail]!.length + 1;
    tail++;
  }

  let tailLine: string | null = null;
  if (tail === 0 && lines.length - head > 0) {
    tailLine = lines[lines.length - 1]!.slice(0, Math.max(0, tailBudget - 1));
    tail = 1;
  }

  const kept = [
    ...timeline.entries.slice(0, head),
    ...timeline.entries.slice(timeline.entries.length - tail),
  ];
  const headLines = lines.slice(0, head);
  if (headLine !== null) headLines[0] = headLine;
  const tailLines = lines.slice(lines.length - tail);
  if (tailLine !== null) tailLines[tailLines.length - 1] = tailLine;
  const text = [...headLines, TIMELINE_TRUNCATION_MARKER, ...tailLines].join('\n');
  return { text, entries: kept, truncated: true };
}
