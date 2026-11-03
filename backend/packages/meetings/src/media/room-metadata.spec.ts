import { decodeRoomMetadata, encodeRoomMetadata } from './meeting-media.js';

describe('room metadata', () => {
  it('mang theo version khi mã hoá và giải mã', () => {
    const raw = encodeRoomMetadata({ title: 'T', aiNotesEnabled: true, hostId: 'h', version: 4 });
    expect(JSON.parse(raw)).toEqual({ title: 'T', aiNotesEnabled: true, hostId: 'h', version: 4 });
    expect(decodeRoomMetadata(raw)).toEqual({
      title: 'T',
      aiNotesEnabled: true,
      hostId: 'h',
      version: 4,
    });
  });

  it('phòng cũ không có version vẫn giải mã được', () => {
    const raw = JSON.stringify({ title: 'T', aiNotesEnabled: false, hostId: 'h' });
    expect(decodeRoomMetadata(raw)).toEqual({ title: 'T', aiNotesEnabled: false, hostId: 'h' });
  });

  it('version sai kiểu bị bỏ qua nhưng phần còn lại vẫn hợp lệ', () => {
    const raw = JSON.stringify({ title: 'T', aiNotesEnabled: true, hostId: 'h', version: 'x' });
    expect(decodeRoomMetadata(raw)).toEqual({ title: 'T', aiNotesEnabled: true, hostId: 'h' });
  });
});
