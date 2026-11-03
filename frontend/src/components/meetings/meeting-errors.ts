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

const BY_MEDIA_ERROR: Record<string, string> = {
  NotAllowedError: "Trình duyệt hoặc hệ điều hành chưa cho phép. Bấm biểu tượng ổ khoá cạnh thanh địa chỉ để cấp quyền, hoặc bạn đã bấm Huỷ ở hộp chọn.",
  SecurityError: "Trình duyệt chặn vì trang không an toàn. Mở Luna bằng https hoặc http://localhost.",
  NotFoundError: "Không tìm thấy thiết bị. Kiểm tra mic/camera đã cắm và bật.",
  NotReadableError: "Thiết bị đang bị ứng dụng khác dùng hoặc hệ điều hành chặn. Đóng ứng dụng đó rồi thử lại.",
  OverconstrainedError: "Thiết bị không hỗ trợ chất lượng yêu cầu. Chọn thiết bị khác.",
  AbortError: "Thiết bị bị ngắt giữa chừng. Thử lại.",
  NotSupportedError: "Trình duyệt này không hỗ trợ. Dùng Chrome, Edge hoặc Firefox bản mới.",
};

export function mediaErrorText(err: unknown): string | null {
  if (typeof window !== "undefined" && (!window.isSecureContext || !navigator.mediaDevices)) {
    return BY_MEDIA_ERROR.SecurityError!;
  }
  const name = err instanceof Error ? err.name : "";
  return BY_MEDIA_ERROR[name] ?? null;
}

export function meetingErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    return BY_MESSAGE[err.message] ?? BY_STATUS[err.status] ?? "Không thực hiện được. Thử lại sau.";
  }
  const media = mediaErrorText(err);
  if (media) return media;
  const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
  return `Không thực hiện được. Kiểm tra kết nối rồi thử lại.${detail}`;
}
