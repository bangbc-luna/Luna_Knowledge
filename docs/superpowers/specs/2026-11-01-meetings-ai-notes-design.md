# Phòng họp trong Luna và biên bản họp do AI ghi

> Ngày: 2026-11-01 · Trạng thái: chờ duyệt · Mockup: `.superpowers/brainstorm/4039640-1793512743/content/meeting.html`

## 1. Vì sao làm

Các buổi họp của công ty (thành viên công ty hoặc nhóm dự án, 5–15 người, người ở văn phòng lẫn ở xa) đang diễn ra trên Google Meet để **phân việc và thống nhất kế hoạch tiếp theo**. Sau buổi họp **không ai ghi biên bản**: mỗi người tự nhớ, nhiều nhất là có file record dài không ai xem lại. Việc ai làm gì dễ bị rơi.

Mục tiêu: họp ngay trong Luna (không cần Google Meet), và sau mỗi buổi họp có **biên bản do AI viết** (giống thư ký AI kiểu Circleback), lưu thành tài liệu trong workspace.

## 2. Mục tiêu, không làm, phản mục tiêu

**Mục tiêu**
- Phòng họp trong Luna: gọi video, chia sẻ màn hình, chat, thả icon tương tác nhanh, giơ tay, danh sách người tham gia, viền sáng người đang nói. Ổn định cho 5–15 người, người ở xa vào được.
- Sau buổi họp, tự sinh biên bản tiếng Việt gồm: **tổng quan** (bàn gì, chốt gì), **phân việc theo từng người** (việc, người phụ trách, hạn nếu có nhắc tới), **chi tiết theo chủ đề**, **bản ghi lời nói** (ai nói gì, lúc nào).
- Biên bản là một **tài liệu Luna** trong workspace của buổi họp: tìm kiếm, sửa, bình luận, phân quyền như tài liệu khác.
- Người được giao việc nhận **thông báo** trong Luna khi biên bản sẵn sàng.

**Không làm (bản đầu)**
- Lưu lại video buổi họp (chỉ giữ âm thanh đủ để chép lời, xoá sau khi có biên bản).
- Đồng bộ task sang công cụ khác (Lark, Jira…), lịch Google, mời người ngoài công ty.
- Chép lời / tóm tắt trực tiếp trong lúc họp (chỉ làm sau khi họp xong).
- Ứng dụng mobile riêng (dùng trình duyệt).

**Phản mục tiêu** (làm xong mà dính là thất bại)
- Biên bản gán việc sai người hoặc bịa việc không ai nói; không có cách kiểm tra lại (phải luôn có bản ghi lời nói để đối chiếu).
- Người trong phòng không biết mình đang được AI ghi lại.
- Người không có quyền xem workspace đọc được biên bản hoặc vào được phòng.
- Họp đông làm nghẽn mạng văn phòng hoặc làm chậm các tính năng hiện có.

## 3. Quyết định đã chốt (của chủ dự án)

- **Gửi âm thanh và nội dung cuộc họp ra dịch vụ AI bên ngoài: được phép.** Chỉ gửi âm thanh và chữ (chép lời, chat). Không gửi video, không gửi màn hình chia sẻ.
- **Máy chủ chuyển tiếp video đặt trên cloud** (SFU được quản lý, ví dụ LiveKit Cloud), không đặt trên server văn phòng. Lý do: không tốn đường upload văn phòng (DEPLOY.md §6: uplink chỉ đủ khoảng 8 người xem 1080p), không phải mở cổng UDP trên router, người ở xa vào ổn định. Code viết sao cho sau này chuyển về tự host được (cùng giao thức, đổi URL/khoá).
- Phạm vi phòng họp và biên bản như mục 2, chủ dự án xác nhận.
- **Mỗi người họp bằng máy và mic riêng** (không có kiểu nhiều người ngồi chung một máy). Vì vậy ghi âm theo từng người là đủ để biết ai nói gì; không cần AI tách giọng trong một luồng.
- **Biên bản theo quyền workspace:** ai xem được workspace thì xem được biên bản (kể cả bản ghi lời nói). Họp trong kho công ty thì cả công ty đọc được biên bản — chủ dự án chấp nhận điều này.
- **Biên bản chờ người chủ trì duyệt:** AI viết xong, biên bản ở trạng thái nháp, chỉ người tạo cuộc họp (và quản trị workspace) thấy và sửa được; người chủ trì bấm "Gửi biên bản" thì tài liệu mới hiện cho mọi người theo quyền workspace và mới gửi thông báo cho người tham gia / người được giao việc.
- **Tài khoản dịch vụ:** plan đề xuất nhà cung cấp (SFU cloud, chép lời tiếng Việt, mô hình viết biên bản) kèm ước tính chi phí/tháng; dev/test dùng tài khoản thử; chủ dự án tạo tài khoản thật trước khi lên production. Chưa đặt trần ngân sách, nhưng phải có số liệu phút họp và chi phí để theo dõi.

## 4. Mô tả chức năng

### 4.1 Tạo và vào phòng
- Phòng họp thuộc một **workspace**. Thành viên workspace vào được; có thể mời thêm người trong công ty không thuộc workspace (giống cơ chế chia sẻ hiện có). Kho công ty và workspace nhóm đều tạo được (quyền tạo: người có quyền sửa nội dung trong workspace — EDITOR trở lên).
- Hai cách: **họp ngay** (tạo và vào) và **đặt lịch** (chọn giờ, mời người → thông báo trong Luna; nhắc trước giờ họp).
- Phòng có trang riêng trong Luna; link mở thẳng vào phòng (đăng nhập Luna như thường).
- Vào phòng: chọn mic/camera trước khi vào (màn chờ), có thể vào với mic/camera tắt.

### 4.2 Trong phòng
- Lưới video + ô lớn khi có người chia sẻ màn hình; viền sáng người đang nói.
- Thanh điều khiển: mic, camera, chia sẻ màn hình, thả icon (hiện ngắn trên ô người thả), giơ tay, rời phòng. Người tạo phòng có thêm: kết thúc cuộc họp cho mọi người, tắt mic người khác, tắt/bật ghi biên bản AI.
- Bảng bên: chat (có gửi link, tin nhắn lưu lại theo buổi họp) và danh sách người tham gia.
- Dòng **"AI đang ghi biên bản"** luôn hiện khi đang ghi; người mới vào được báo trước khi vào.
- Watermark/quyền: chỉ người có quyền mới lấy được token vào phòng (token ngắn hạn do API Luna cấp).

### 4.3 Sau buổi họp
- Buổi họp kết thúc khi người tạo bấm kết thúc hoặc người cuối cùng rời phòng (và một khoảng chờ ngắn).
- Hệ thống lấy **âm thanh riêng của từng người** (để biết chính xác ai nói), chép lời có mốc thời gian, ghép với chat theo thời gian, rồi nhờ AI viết biên bản.
- Biên bản được tạo thành **tài liệu rich-text** trong workspace (thư mục mặc định "Biên bản họp" ở gốc khu Tài liệu, người làm quyết định tên/chỗ cụ thể), gồm các phần ở mục 2; việc được giao gắn **@mention đúng tài khoản** người tham gia (hiện @mention mới có trong bình luận — cần thêm vào nội dung tài liệu).
- Biên bản ở trạng thái **nháp** tới khi người chủ trì duyệt và bấm gửi (mục 3). Sau khi gửi: người tham gia và người được giao việc nhận thông báo. Trang buổi họp hiện trạng thái "đang xử lý" → "chờ duyệt" → link tới tài liệu.
- Nếu AI lỗi: buổi họp vẫn có bản ghi lời nói (nếu chép lời xong) và nút thử lại; nếu chép lời cũng lỗi, giữ âm thanh tới khi xử lý lại được hoặc hết hạn giữ.
- **Âm thanh bị xoá** sau khi biên bản tạo xong (giữ tối đa N ngày nếu xử lý lỗi; N là env, mặc định 7).

## 5. Ràng buộc

- Theo quy ước dự án: không comment trong code; tiếng Việt cho giao diện và tài liệu; UI làm theo quy trình skill `evon:ui-ux`, hợp với bố cục rail + cây hiện có.
- Không làm chậm các tính năng hiện có: xử lý biên bản chạy ở worker (BullMQ) với giới hạn tài nguyên như các job khác; không có I/O mạng khi giữ khoá cây (đợt 2) — tạo tài liệu biên bản đi qua `NodeTree`.
- Bảo mật như các phần khác: token phòng họp ngắn hạn, kiểm quyền workspace ở mọi bước, audit log cho tạo/kết thúc họp và tạo biên bản; khoá API của dịch vụ cloud/AI nằm trong env, không tới trình duyệt; CSP của frontend phải cho phép miền của dịch vụ video (wss + media).
- Server văn phòng không cần mở cổng vào mới: mọi kết nối tới dịch vụ cloud là kết nối đi ra.
- Chi phí theo phút họp (video + AI) phải theo dõi được (số phút, số buổi) — ít nhất là ghi lại để admin xem.

## 6. Quyết định của người viết tài liệu (chủ dự án chưa nói, có thể sửa)

- **Người được mời từ ngoài workspace:** khi biên bản được gửi, họ nhận quyền **Chỉ xem** trên đúng tài liệu biên bản đó (share như cơ chế hiện có), vì họ đã dự họp.
- **Giao việc cho người không dự họp** (ví dụ "anh Hùng sẽ làm" khi Hùng vắng): AI chỉ gợi ý; khớp tên với thành viên workspace. Khớp được thì gắn @mention, chủ trì xác nhận lúc duyệt; không khớp được thì để chữ thường, không thông báo. Người được gắn mà không xem được tài liệu thì không thông báo (tránh lộ nội dung).
- **Ghi biên bản AI bật mặc định**; người tạo phòng tắt được. Không có tuỳ chọn từng người từ chối ghi âm riêng; người vào sau thấy thông báo "cuộc họp đang được AI ghi biên bản" trên màn chờ trước khi vào.
- **Băng thông:** dùng simulcast; giới hạn camera gửi tối đa 720p, tự hạ chất lượng nhận theo kích thước ô; chia sẻ màn hình ưu tiên độ nét chữ ở tốc độ khung hình thấp. Đo thử với nhóm thật trước khi dùng rộng.

## 7. Để lại cho người làm (gợi ý là quyết định của người viết tài liệu)

- **Nhà cung cấp SFU:** gợi ý LiveKit Cloud (có SDK web/React, có cách lấy track âm thanh từng người, có thể tự host bằng LiveKit server sau này). Người làm có thể đề xuất khác nếu đáp ứng mục 3.
- **Cách lấy âm thanh từng người:** egress theo track hoặc một tiến trình "bot" phía server kết nối ra cloud và ghi âm thanh — chọn cách không cần mở cổng vào và lưu file vào MinIO.
- **Mô hình chép lời tiếng Việt và mô hình viết biên bản:** chọn sau khi thử chất lượng trên vài đoạn họp tiếng Việt có xen thuật ngữ tiếng Anh. Có sẵn OmniRoute (Gemini) trong môi trường; Claude cũng là lựa chọn. Ghi rõ lựa chọn, chi phí ước tính mỗi phút trong plan.
- Cấu trúc dữ liệu (bảng meeting, participant, chat, transcript), cách ánh xạ người nói → tài khoản, prompt và định dạng đầu ra có kiểu (JSON → tài liệu Tiptap).
- Màn hình cụ thể (danh sách buổi họp trong workspace, trang buổi họp, phòng họp), dựa trên mockup.
