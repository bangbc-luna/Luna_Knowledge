import { toNotificationDto, writeNotifications } from '@luna/db';
import { vi } from 'vitest';

const row = {
  id: 'n1',
  userId: 'u1',
  type: 'meeting.invited',
  payload: { meetingId: 'm1' },
  readAt: null,
  createdAt: new Date('2026-11-03T00:00:00Z'),
};

describe('toNotificationDto', () => {
  it('giữ đúng các trường công khai và bỏ userId', () => {
    expect(toNotificationDto(row)).toEqual({
      id: 'n1',
      type: 'meeting.invited',
      payload: { meetingId: 'm1' },
      readAt: null,
      createdAt: row.createdAt,
    });
  });

  it('writeNotifications phát đúng dạng DTO này lên kênh của người nhận', async () => {
    const publish = vi.fn(async () => 1);
    const db = { notification: { createManyAndReturn: vi.fn(async () => [row]) } };
    await writeNotifications(db as never, publish, ['u1'], 'meeting.invited', { meetingId: 'm1' });
    const [, message] = publish.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(message)).toEqual(JSON.parse(JSON.stringify(toNotificationDto(row))));
  });
});
