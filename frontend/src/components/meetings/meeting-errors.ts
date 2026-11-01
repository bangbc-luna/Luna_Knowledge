import { ApiError } from "@/lib/api";

const BY_MESSAGE: Record<string, string> = {
  "This meeting has not started yet": "Phòng chưa mở. Bạn vào được khi đến giờ mở phòng.",
  "This meeting has not started": "Buổi họp chưa bắt đầu.",
  "This meeting has already ended": "Buổi họp đã kết thúc hoặc đã bị huỷ.",
  "This meeting has already started": "Buổi họp đã bắt đầu nên không thể sửa hay huỷ.",
  "You are not in the meeting room": "Bạn chưa ở trong phòng họp.",
  "Chat is only open while the meeting is live": "Chat chỉ mở khi buổi họp đang diễn ra.",
  "Meeting not found": "Không tìm thấy buổi họp.",
  "Invite not found": "Không tìm thấy lời mời này.",
  "Only the meeting host can do this": "Chỉ chủ trì mới làm được việc này.",
  "Only the meeting host or a workspace admin can do this": "Chỉ chủ trì hoặc quản trị workspace mới làm được việc này.",
  "The meeting service is unavailable, try again in a moment": "Dịch vụ họp đang tạm thời không dùng được, thử lại sau ít phút.",
  "scheduledAt must not be in the past": "Giờ họp không được ở quá khứ.",
};

const BY_STATUS: Record<number, string> = {
  401: "Phiên đăng nhập đã hết hạn.",
  403: "Bạn không có quyền làm việc này.",
  404: "Không tìm thấy buổi họp.",
  409: "Trạng thái buổi họp đã thay đổi, thử lại sau khi tải lại.",
  429: "Bạn thao tác quá nhanh, chờ một chút rồi thử lại.",
  503: "Dịch vụ họp đang tạm thời không dùng được, thử lại sau ít phút.",
};

export function meetingErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    return BY_MESSAGE[err.message] ?? BY_STATUS[err.status] ?? "Không thực hiện được. Thử lại sau.";
  }
  return "Không thực hiện được. Kiểm tra kết nối rồi thử lại.";
}
