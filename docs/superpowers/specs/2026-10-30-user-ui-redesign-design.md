# Làm lại giao diện người dùng: kho tri thức công ty

> Ngày: 2026-10-30 · Trạng thái: chờ duyệt · Mockup đã chọn: phương án A (`.superpowers/brainstorm/*/content/layout.html`)

## 1. Vì sao làm

Giao diện hiện tại hợp với admin theo dõi hệ thống, nhưng với người dùng thường thì chưa ổn (lời chủ dự án):

- Muốn đổi workspace hoặc tạo workspace mới phải mở sidebar (dropdown trong sidebar); cài đặt workspace cũng nằm cuối sidebar.
- Màn chính trông như Google Drive (bảng file), không ra một trang lưu trữ, đọc và soạn tài liệu công ty.
- Margin/padding quá nhiều; nội dung bị giới hạn chiều rộng. Khoảng cách chỉ nên đủ để tách section/component, còn lại dành cho nội dung và giãn theo màn hình.

## 2. Mục tiêu, không làm, phản mục tiêu

**Mục tiêu**
- Chuyển workspace bằng **một lần bấm**, luôn nhìn thấy; tạo workspace ngay tại đó.
- Duyệt nội dung bằng **cây tài liệu**, mở tài liệu là đọc/soạn ngay trong màn chính.
- Nội dung chiếm phần lớn chiều rộng, giãn theo màn hình; khoảng cách gọn.

**Không làm**
- Đổi API backend chỉ để phục vụ giao diện, trừ khi thiếu dữ liệu (xem mục 6).
- Làm lại khu admin (`/admin/*`): giữ bố cục dashboard, chỉ áp dụng khoảng cách gọn mới.
- Thêm tính năng mới (chủ dự án sẽ mô tả tính năng mới sau).

**Phản mục tiêu**
- Màn chính vẫn là lưới/bảng file kiểu Drive khi đang mở tài liệu.
- Mất tính năng đang có (chia sẻ, thùng rác, yêu thích, gần đây, tìm kiếm ⌘K, thông báo, thành viên, upload, phiên bản, bình luận, phân quyền hiển thị theo vai trò).
- Hỏng trên điện thoại.

## 3. Bố cục (phương án A)

```
┌────┬──────────────────┬───────────────────────────────────────────┬──────────┐
│ LT │ LunaTech       ⚙ │ Quy trình / Onboarding   [Tìm… ⌘K]  🔔 👤 │          │
│ BE │ [Tài liệu|Video] ├───────────────────────────────────────────┤ Mục lục  │
│ MK │ ▾ Quy trình      │ Onboarding nhân viên mới                  │ Bình luận│
│ HR │   Onboarding ◀   │ Sửa bởi Minh Anh · 2 giờ trước            │          │
│ ＋ │   Nghỉ phép      │ …nội dung giãn hết chiều rộng…            │          │
│    │ ▸ Kỹ thuật       │                                           │          │
│    │ ★ Yêu thích …    │                                           │          │
└────┴──────────────────┴───────────────────────────────────────────┴──────────┘
 rail   cây nội dung      màn chính                                  panel phải
```

- **Cột workspace (rail)**, luôn hiện: mỗi workspace là một ô vuông viết tắt (tooltip tên đầy đủ), kho công ty đứng đầu, ô đang chọn được đánh dấu, cuối cột nút **＋ tạo workspace** (mở dialog tạo hiện có).
- **Cột cây nội dung**: đầu cột tên workspace và vai trò, nút **⚙ cài đặt** (chỉ khi có quyền quản trị, mở dialog cài đặt hiện có). Tab **Tài liệu / Video**. Cây thư mục mở/đóng được, tải con khi mở. Mục đang mở được đánh dấu. Cuối cột: Được chia sẻ, Yêu thích, Gần đây, Thùng rác (ẩn với VIEWER như hiện tại). Hành động tạo (tài liệu, thư mục, upload) truy cập được từ cây.
- **Thanh trên** mỏng: breadcrumb, tìm kiếm ⌘K, thành viên, thông báo, tài khoản.
- **Màn chính** theo loại mục:
  - Tài liệu: đọc/soạn ngay, giãn theo chiều rộng.
  - File: xem trước (PDF, ảnh…) như hiện tại.
  - Thư mục ở tab Tài liệu: danh sách gọn (bảng mật độ cao), không phải lưới kiểu Drive.
  - Thư mục ở tab Video: lưới thumbnail; mở video là trang xem video hiện có.
  - Gốc workspace (chưa chọn mục): danh sách gọn của gốc + tài liệu mới cập nhật trong workspace. Chủ dự án đồng ý **thêm endpoint backend** trả các mục mới sửa trong một workspace và section, lọc theo quyền xem, phân trang cursor, có test e2e.
- **Rail và cây hiện trên mọi trang người dùng** (quyết định của người viết tài liệu): Được chia sẻ, Yêu thích, Gần đây, Tìm kiếm vẫn là danh sách **toàn hệ thống** như hiện tại. Khi ở các trang đó, rail giữ workspace dùng gần nhất (nhớ trong trình duyệt) và cây của nó vẫn hiện. Vì vậy các lối tắt này đặt ở phần cố định cuối cột cây, tách khỏi phần cây của workspace, kèm biểu tượng thể hiện là chung. Thùng rác thuộc về workspace nên nằm cùng cây. Mọi tài khoản luôn thuộc kho công ty nên rail không bao giờ trống.
- Bấm một workspace trên rail: vào gốc tab Tài liệu của workspace đó (`/w/[wsId]/f`).
- **Panel phải** (chỉ với tài liệu, ẩn/hiện được): mục lục, bình luận.
- **Điện thoại**: rail và cây gộp thành một menu trượt.

## 4. Khoảng cách và chiều rộng

- Bỏ mọi `max-w` giới hạn vùng nội dung; nội dung giãn theo màn hình.
- Padding vùng nội dung giảm mạnh (khoảng 8–12px), khoảng cách giữa section nhỏ; tách khu bằng đường kẻ mảnh thay vì khoảng trống lớn.
- Thanh trên thấp hơn hiện tại (`h-16` → khoảng 40–44px), dòng danh sách gọn hơn.
- Áp dụng cùng thang khoảng cách cho admin.

## 5. Ràng buộc

- Mọi việc giao diện đi qua quy trình skill `evon:ui-ux`; kiểm tra bằng dev login `?as=`.
- Code không có comment.
- Next.js 16: đọc docs trong `node_modules/next/dist/docs/` trước khi đổi routing/layout.
- Giữ nguyên URL hiện có (`/w/[wsId]/f/...`, `/w/[wsId]/v/...`, `/w/[wsId]/doc/[nodeId]`, `/w/[wsId]/file/[nodeId]`) để link cũ và thông báo vẫn đúng.

## 6. Để lại cho người làm

- Cây tải con từng cấp bằng API liệt kê folder hiện có; nếu quá chậm (nhiều request) thì đề xuất thêm endpoint trả cây, không tự thêm.
- Màu, icon, typography: giữ token hiện có trong `globals.css`, chỉnh khi cần cho rail tối.
- Kéo-thả trong cây: không bắt buộc.
- Trong cây có thư mục, tài liệu và file (thư mục là nhánh, còn lại là lá).
- Vị trí panel thành viên khi panel phải đang dành cho tài liệu; mục lục cho tài liệu LaTeX; breakpoint thu gọn trên laptop màn hình vừa.
- Cách viết tắt tên workspace trong ô rail.
