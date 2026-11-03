import { MINUTES_OUTPUT_RULES, MINUTES_SYSTEM_PROMPT, buildMinutesUserMessage } from './prompt.js';

describe('prompt', () => {
  it('chỉ dẫn đủ các luật bắt buộc bằng tiếng Việt', () => {
    expect(MINUTES_OUTPUT_RULES).toContain('evidence');
    expect(MINUTES_OUTPUT_RULES).toContain('ownerSpeakerId là null');
    expect(MINUTES_OUTPUT_RULES).toContain('ambiguous là true');
    expect(MINUTES_OUTPUT_RULES).toContain('deferred');
    expect(MINUTES_OUTPUT_RULES).toContain('notableChat');
    expect(MINUTES_SYSTEM_PROMPT).toContain('thuật ngữ tiếng Anh');
    expect(MINUTES_SYSTEM_PROMPT).toContain('Không suy diễn');
  });

  it('thông điệp người dùng có ngày họp, người dự và bản ghi', () => {
    const m = buildMinutesUserMessage({
      title: 'Họp',
      meetingDate: '2026-11-03',
      speakers: [{ speakerId: 'S1', userId: 'u', name: 'Tuấn' }],
      timeline: '[U1 00:00:01] S1 Tuấn: hi',
    });
    expect(m).toContain('2026-11-03');
    expect(m).toContain('S1: Tuấn');
    expect(m).toContain('[U1 00:00:01]');
  });
});
