import type { MinutesDraft } from './schema.js';
import type { Speaker } from './timeline.js';

const MAX_SUMMARY = 4000;
const MAX_ITEMS = 100;
const SPEAKER_ID = /^S\d+$/;

const clip = (s: string, n: number) => s.slice(0, n);

function realDate(s: string | null): string | null {
  if (s === null) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

const cap = <T>(list: T[]): T[] => list.slice(0, MAX_ITEMS);

export function validateDraft(
  draft: MinutesDraft,
  refs: Set<string>,
  speakers: Speaker[],
): { draft: MinutesDraft; droppedItemCount: number } {
  const known = new Set(speakers.map((s) => s.speakerId));
  const kept: MinutesDraft['actionItems'] = [];
  let droppedItemCount = 0;

  for (const item of draft.actionItems) {
    const evidence = [...new Set(item.evidence.filter((r) => refs.has(r)))];
    const task = item.task.trim();
    if (evidence.length === 0 || task === '') {
      droppedItemCount += 1;
      continue;
    }
    let { ownerSpeakerId, ownerName } = item;
    if (ownerSpeakerId !== null && !known.has(ownerSpeakerId)) {
      ownerName = ownerName ?? (SPEAKER_ID.test(ownerSpeakerId) ? null : ownerSpeakerId);
      ownerSpeakerId = null;
    }
    if (item.ambiguous) {
      ownerSpeakerId = null;
      ownerName = null;
    }
    kept.push({
      ...item,
      task: clip(task, 500),
      evidence,
      ownerSpeakerId,
      ownerName: ownerName === null ? null : clip(ownerName, 120),
      dueText: item.dueText === null ? null : clip(item.dueText, 120),
      dueDate: realDate(item.dueDate),
    });
  }

  return {
    draft: {
      overview: {
        summary: draft.overview.summary.slice(0, MAX_SUMMARY),
        decisions: cap(draft.overview.decisions).map((x) => clip(x, 1000)),
        deferred: cap(draft.overview.deferred).map((x) => clip(x, 1000)),
        openQuestions: cap(draft.overview.openQuestions).map((x) => clip(x, 1000)),
      },
      actionItems: cap(kept),
      topics: cap(draft.topics).map((t) => ({
        title: clip(t.title, 200),
        points: cap(t.points).map((x) => clip(x, 1000)),
      })),
      notableChat: cap([
        ...new Set(draft.notableChat.filter((r) => refs.has(r) && r.startsWith('C'))),
      ]),
    },
    droppedItemCount,
  };
}
