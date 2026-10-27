# Kịch bản demo Luna Knowledge

Dành cho người trình bày demo trên máy dev. Kịch bản đi theo một câu chuyện liền mạch: kho công ty có nội dung, nhân viên mới vào xem, một nhóm dự án lập workspace riêng, mời thành viên, cùng soạn tài liệu, chia sẻ cho người ngoài, rồi quản trị hệ thống kiểm tra nhật ký. Mỗi bước ghi vai trò đang dùng, việc cần bấm và điều người xem phải thấy.

Thời lượng: khoảng 30 phút nếu đi hết, 10 phút nếu chỉ làm các bước có dấu ★.

## 1. Chuẩn bị (5 phút trước buổi demo)

```bash
cd ~/Documents/Luna/Luna_Knowledge/backend && pnpm dev        # terminal 1
cd ~/Documents/Luna/Luna_Knowledge/frontend && pnpm dev       # terminal 2
cd ~/Documents/Luna/Luna_Knowledge/backend && pnpm test:cleanup   # xoá tài khoản và dữ liệu test cũ
```

- `backend/.env` phải là `NODE_ENV=development`, nếu không thì không có đăng nhập nhanh.
- Mở http://localhost:5173. Đổi vai trò bằng danh sách **Đăng nhập nhanh** ở trang đăng nhập, hoặc menu tài khoản góc phải trên.
- Đăng nhập lần lượt **QA Member**, **QA Shared Viewer**, **QA Shared Editor** một lần rồi đăng xuất, để hệ thống có sẵn các tài khoản này: ô gợi ý tên khi mời và cấp quyền chỉ tìm thấy người đã đăng nhập ít nhất một lần.
- Mở thêm **một cửa sổ ẩn danh** (Ctrl+Shift+N) cho bước soạn tài liệu cùng lúc: mỗi cửa sổ giữ một người đăng nhập riêng.
- File mẫu để upload nằm ở `backend/tests/fixtures/`: `sample.pdf`, `sample.docx`, `sample.xlsx`, `sample.png`, `sample.mp4` (video 4 giây). Muốn demo tua và xem tiếp thì chuẩn bị thêm một video thật dài vài phút.

## 2. Vai trò và tài khoản dùng trong demo

| Vai trò trong câu chuyện | Tài khoản đăng nhập nhanh | Quyền thực tế |
|---|---|---|
| Quản trị hệ thống | System Admin (`admin@lunatech.vn`) | System Admin, quản trị kho công ty LunaTech |
| Nhân viên mới | QA Outsider (`qa.outsider@`) | Chỉ xem kho công ty, chưa thuộc nhóm nào |
| Trưởng nhóm dự án | QA Creator (`qa.creator@`) | Tự tạo workspace nhóm nên là **quản trị** của nó |
| Thành viên dự án | QA Member (`qa.member@`) | Được trưởng nhóm mời vào với vai trò **thành viên** |
| Khách xem (phòng khác) | QA Shared Viewer (`qa.shared.viewer@`) | Được share **Chỉ xem** một thư mục |
| Cộng tác viên | QA Shared Editor (`qa.shared.editor@`) | Được share **Được chỉnh sửa** một thư mục |

Mọi tài khoản @lunatech.vn tự động có quyền **Chỉ xem** kho công ty LunaTech ngay lần đăng nhập đầu.

## 3. Kịch bản

### Phần A. Quản trị hệ thống chuẩn bị kho công ty (System Admin)

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| A1 ★ | Đăng nhập **System Admin**. Sidebar trái: Tài liệu, Video, Được chia sẻ, Yêu thích, Gần đây, Thùng rác; đáy sidebar có **Cài đặt «LunaTech»** | Đầu sidebar ghi "Công ty · Quản trị / LunaTech" |
| A2 ★ | **Thư mục mới** → "Quy định & chính sách". Vào thư mục, **Tải lên** `sample.pdf` | Khay tải lên góc dưới hiện tiến độ rồi **Đã tải xong**; vài giây sau mở file thấy bản xem trước PDF |
| A3 | Tải lên `sample.docx` vào cùng thư mục, mở file, bấm **Chuyển thành tài liệu** | Tạo ra một tài liệu soạn thảo được, giữ định dạng và ảnh của file Word |
| A4 ★ | Về Tài liệu, **Tài liệu mới** → đặt tên "Sổ tay nhân viên mới", gõ vài đoạn, chèn bảng, chèn ảnh `sample.png` | Tự lưu, không có nút Lưu; góc trên ghi người sửa cuối |
| A5 | Menu **⋯** của tài liệu → **Lịch sử phiên bản** → **Lưu phiên bản** tên "Bản ban hành" | Phiên bản có tên xuất hiện trong danh sách |
| A6 ★ | Sidebar → **Video** → **Thư mục mới** "Đào tạo hội nhập" → tải lên `sample.mp4` | Thanh tiến độ chuyển mã; xong thì phát được, có chọn chất lượng |
| A7 | Bấm **Thành viên** (thanh trên) → ô **Cấp quyền đăng bài**: gõ "qa member" (không dấu cũng được), chọn từ gợi ý, chọn vai trò **Thành viên**, **Lưu** | Người được chọn chuyển từ Chỉ xem sang Thành viên của kho công ty, tức là được đăng nội dung. Cần QA Member đã đăng nhập ít nhất một lần (bước chuẩn bị ở mục 1) |

### Phần B. Nhân viên mới xem kho công ty (QA Outsider, chỉ xem)

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| B1 ★ | Đăng nhập **QA Outsider** | Vào thẳng kho LunaTech, thấy mọi thư mục admin vừa tạo. Không có nút Tải lên, Thư mục mới, Tài liệu mới; không có Thùng rác, không có Cài đặt |
| B2 ★ | **Ctrl+K**, gõ "so tay nhan vien" (không dấu) | Ra "Sổ tay nhân viên mới", phần khớp được tô đậm; bấm Enter mở tài liệu |
| B3 | Trong tài liệu: không gõ được (chỉ đọc). Bôi đen một đoạn → **Thêm bình luận** → gửi | Người chỉ xem vẫn bình luận được |
| B4 ★ | Mở video "Đào tạo hội nhập" | Phát được, góc video hiện watermark tên + email người xem; không có nút tải về |
| B5 | Xem video quá 5 giây, đóng giữa chừng, mở lại | Video tự phát tiếp từ chỗ dừng. Cần một video dài hơn 15 giây; `sample.mp4` chỉ 4 giây nên không minh hoạ được bước này |
| B6 | Mở `sample.pdf` → **Tải về** | Tải được file gốc (tài liệu thì tải được, video thì không) |
| B7 | Mở "Sổ tay nhân viên mới" → **⋯** → **Tạo bản sao** | Hộp báo "Bạn chưa có workspace nào được thêm tài liệu" kèm nút **Tạo workspace**; tạo xong thì chọn ngay workspace mới làm nơi đặt bản sao |

### Phần C. Trưởng nhóm lập workspace dự án (QA Creator, quản trị workspace)

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| C1 ★ | Đăng nhập **QA Creator** | Đầu sidebar ghi "Công ty · Chỉ xem": trưởng nhóm cũng chỉ xem kho công ty |
| C2 ★ | Bấm tên workspace ở đầu sidebar → **Tạo workspace** "Dự án Mobile" | Chuyển vào workspace mới, đầu sidebar ghi "Workspace · Quản trị" |
| C3 ★ | **Thành viên** → ô **Mời vào workspace**: gõ "member" → chọn **QA Member** từ gợi ý → vai trò **Thành viên** → **Mời** | Gợi ý hiện tên và email; người đã ở trong workspace hiện mờ "Đã ở trong workspace". Người chưa đăng nhập lần nào thì gõ đủ email để mời |
| C4 | Tạo thư mục "Thiết kế" và "Hợp đồng"; tải `sample.pdf` vào "Hợp đồng" | — |
| C5 | Tải lại đúng `sample.pdf` lần nữa với tên khác | Khay tải lên báo **Trùng nội dung với «…»**; trang file có khung vàng liệt kê bản trùng (chỉ cảnh báo, không chặn) |
| C6 | Vào Tài liệu của Dự án Mobile, **⋯** của một dòng → **Gắn tag** → tạo tag "Ưu tiên" | Tag hiện ở cột Tag |
| C7 | Vào kho LunaTech, mở "Sổ tay nhân viên mới" → **⋯** → **Tạo bản sao** → chọn Workspace "Dự án Mobile" → **Tạo bản sao** | Mở ngay bản sao trong Dự án Mobile, sửa được; bản gốc của công ty không đổi |
| C8 | Đáy sidebar → **Cài đặt «Dự án Mobile»** → đổi mô tả | — |

### Phần D. Cùng soạn tài liệu (QA Creator + QA Member)

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| D1 ★ | Cửa sổ thường: QA Creator tạo tài liệu "Kế hoạch sprint 1" trong Dự án Mobile. Cửa sổ ẩn danh: đăng nhập **QA Member**, mở cùng tài liệu | Góc trên hiện avatar người đang mở cùng |
| D2 ★ | Hai người gõ cùng lúc ở hai đoạn khác nhau | Chữ của người kia hiện ngay, có con trỏ kèm tên |
| D3 | QA Member bôi đen một đoạn → bình luận "@QA Creator xem giúp" (gõ @ để chọn người) | QA Creator thấy chấm đỏ ở chuông thông báo, bấm vào mở đúng bình luận |
| D4 | QA Creator trả lời, bấm **Đánh dấu xong** | Thread chuyển sang trạng thái đã xong, xem lại ở tab **Đã xong** của bộ lọc bình luận |
| D5 | **⋯** → **Lịch sử phiên bản** → chọn một phiên bản → **So với hiện tại** → **Khôi phục** | Thấy chữ thêm/bớt; khôi phục tạo phiên bản mới, cả hai cửa sổ cập nhật ngay |
| D6 | QA Member thử **⋯** của một dòng trong thư mục | Có Đổi tên, Di chuyển, Gắn tag, Xoá vào thùng rác; **không có Chia sẻ** (chỉ quản trị mới chia sẻ) |
| D7 | QA Member **Xoá vào thùng rác** một file → mở **Thùng rác** | Thấy mục vừa xoá, tự khôi phục được; không có nút Xoá vĩnh viễn |
| D8 | QA Creator mở **Thùng rác** | Khôi phục được mọi mục, có **Xoá vĩnh viễn** và **Dọn sạch** |
| D9 | QA Creator mở thư mục "Hợp đồng" → **⋯** → **Hoạt động** | Thấy ai tạo, sửa, xoá, khôi phục gì, lúc nào; sửa tài liệu ghi cả số từ thêm/bớt |

### Phần E. Chia sẻ cho người ngoài nhóm

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| E1 ★ | QA Creator: thư mục "Thiết kế" → **Chia sẻ** → `qa.shared.viewer@lunatech.vn`, quyền **Chỉ xem** | — |
| E2 | Cùng thư mục, chia sẻ `qa.shared.editor@lunatech.vn`, quyền **Được chỉnh sửa** | — |
| E3 ★ | Đăng nhập **QA Shared Viewer** → sidebar **Được chia sẻ** | Thấy đúng thư mục "Thiết kế", mở xem và tải được; không thấy thư mục "Hợp đồng" hay phần khác của Dự án Mobile; tìm kiếm cũng chỉ ra những gì được share |
| E4 | Đăng nhập **QA Shared Editor** → mở "Thiết kế" | Tải lên, sửa, xoá, chia sẻ tiếp được **trong thư mục đó**, nhưng không vào được phần còn lại của workspace |
| E5 | QA Creator thu hồi share của Shared Viewer | Shared Viewer tải lại trang thì không còn thấy thư mục; video đang phát bị chặn ở lần lấy khoá kế tiếp |

### Phần F. Quản trị hệ thống kiểm tra (System Admin)

| # | Làm gì | Người xem phải thấy |
|---|---|---|
| F1 ★ | Đăng nhập **System Admin** → menu tài khoản → **Quản trị** | Tổng quan: số người dùng, workspace, nội dung, biểu đồ hoạt động 7 ngày |
| F2 ★ | **Nhật ký**: lọc theo người QA Member, rồi theo hành động "Xoá" | Thấy đủ dấu vết các bước D7; bấm một dòng xem chi tiết; **Xuất CSV** |
| F3 | **Video** → chọn video → **Tải file gốc** | Link tải dùng một lần trong 60 giây, có ghi nhật ký |
| F4 | **Người dùng** → QA Outsider → **Khoá tài khoản** | Phiên của QA Outsider bị thu hồi ngay; người này không đăng nhập lại được cho tới khi **Mở khoá tài khoản** |
| F5 | **Workspace** → xem danh sách, thành viên từng workspace | Kho công ty không xoá được; workspace nhóm xoá được |

## 4. Bảng quyền để đối chiếu nhanh

Dấu ✓ là làm được, — là không có nút hoặc bị chặn.

| Chức năng | System Admin | Quản trị workspace | Thành viên | Chỉ xem | Share Chỉ xem | Share Được chỉnh sửa |
|---|---|---|---|---|---|---|
| Xem, tải tài liệu, xem video, tìm kiếm | ✓ | ✓ | ✓ | ✓ | ✓ (phần được share) | ✓ (phần được share) |
| Bình luận | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tạo bản sao tài liệu về workspace của mình | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tạo thư mục, tài liệu, tải lên, sửa, di chuyển | khi là quản trị/thành viên | ✓ | ✓ | — | — | ✓ (trong phần được share) |
| Xoá vào thùng rác | khi là quản trị/thành viên | ✓ | ✓ | — | — | ✓ |
| Khôi phục từ thùng rác | ✓ mọi mục | ✓ mọi mục | mục mình xoá | — | — | — |
| Xoá vĩnh viễn, dọn thùng rác | ✓ | ✓ | — | — | — | — |
| Chia sẻ | khi là quản trị | ✓ | — | — | — | ✓ (trong phần được share) |
| Xem Hoạt động của mục | ✓ | ✓ | — | — | — | ✓ |
| Tạo tag / sửa, xoá tag | khi là thành viên / ✓ | ✓ / ✓ | ✓ / — | — | — | — |
| Mời, đổi vai trò, gỡ thành viên; cài đặt workspace | ✓ | ✓ | — (chỉ tự rời) | — | — | — |
| Tạo workspace nhóm mới | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trang Quản trị, nhật ký toàn hệ thống, khoá tài khoản, file gốc video | ✓ | — | — | — | — | — |

## 5. Sau buổi demo

```bash
cd ~/Documents/Luna/Luna_Knowledge/backend && pnpm test:cleanup
```

Xoá mọi tài khoản `qa.*`, workspace, nội dung, file và nhật ký do các tài khoản đó tạo. Nội dung do System Admin tạo trong kho LunaTech (phần A) **không** bị xoá; xoá tay trong trang nếu không cần.
