import type { Speaker } from './timeline.js';

export const MINUTES_SYSTEM_PROMPT = [
  'Bạn là thư ký cuộc họp của một đội phần mềm Việt Nam. Nhiệm vụ: đọc bản ghi lời nói và tin nhắn chat của buổi họp rồi viết biên bản ngắn gọn, chính xác bằng tiếng Việt.',
  'Chỉ ghi những gì có trong bản ghi. Không suy diễn, không bịa thêm việc, người, ngày hay con số.',
  'Giữ nguyên các thuật ngữ tiếng Anh (ví dụ: sprint, release, deploy, review, API) và tên riêng, không dịch.',
].join('\n');

export const MINUTES_OUTPUT_RULES = [
  'Trả về duy nhất một đối tượng JSON đúng cấu trúc: overview { summary, decisions, deferred, openQuestions }, actionItems, topics, notableChat.',
  'overview.summary: một đoạn tóm tắt mục tiêu và kết quả chính. overview.decisions: các điều đã chốt. overview.deferred: việc được hoãn lại. overview.openQuestions: câu hỏi hoặc việc còn bỏ ngỏ. Nhóm nào không có thì trả mảng rỗng.',
  'actionItems: chỉ ghi việc có người nói rõ ràng. Mỗi việc bắt buộc có evidence là danh sách refId (U… hoặc C…) của câu giao hoặc nhận việc; việc không có căn cứ thì bỏ.',
  'ownerSpeakerId chỉ điền khi người phụ trách là người dự họp (mã S…). Nếu người phụ trách vắng mặt hoặc không có trong danh sách người dự thì ownerSpeakerId là null và ownerName ghi đúng như được gọi trong lời nói.',
  'Nếu nhiều người cùng xung phong nhận một việc mà chưa chốt ai, đặt ambiguous là true, ownerSpeakerId và ownerName là null. Các trường hợp khác ambiguous là false.',
  'dueDate (YYYY-MM-DD) chỉ điền khi suy ra chắc chắn từ ngày họp đã cho; còn lại để null và giữ nguyên cách nói trong dueText.',
  'topics: mỗi chủ đề có title ngắn và points là các ý chính theo thứ tự thảo luận.',
  'notableChat: refId (C…) của những tin nhắn chat đáng chú ý như liên kết, tài liệu, số liệu; không chọn tin nhắn xã giao.',
  'Không suy diễn: nếu không chắc thì bỏ qua hoặc để null.',
].join('\n');

export function buildMinutesUserMessage(input: {
  title: string;
  meetingDate: string;
  speakers: Speaker[];
  timeline: string;
}): string {
  const people = input.speakers.map((s) => `${s.speakerId}: ${s.name}`).join('\n');
  return [
    `Tên buổi họp: ${input.title}`,
    `Ngày họp: ${input.meetingDate}`,
    `Người dự:\n${people}`,
    `Bản ghi:\n${input.timeline}`,
  ].join('\n\n');
}
