# Triển khai Luna Knowledge trên server văn phòng

Tài liệu cho người trực vận hành. Mỗi bước có lệnh copy được và cách kiểm tra đã làm đúng chưa. Mọi lệnh chạy trong thư mục `backend/` của repo trên server (ví dụ `/opt/luna/backend`).

## 1. Sơ đồ

```
Trình duyệt ──https──> Traefik :443 ──> frontend (Next.js)            knowledge.lunatech.vn
                              ├────────> api :4000      /api/...       knowledge.lunatech.vn/api
                              ├────────> collab :4001   /collab (wss)  knowledge.lunatech.vn/collab
                              └────────> minio :9000                   media.knowledge.lunatech.vn
                                         (tải file, xem video bằng URL ký sẵn)

Mạng nội bộ Docker (không mở ra ngoài): postgres, redis, meilisearch, tika, gotenberg, worker
Truy cập từ xa (tuỳ chọn): cloudflared ──tunnel──> Traefik
```

- `migrate` chạy một lần mỗi khi khởi động: áp migration DB và tạo bucket còn thiếu, xong thì api/worker/collab mới chạy.
- Postgres và MinIO chỉ mở trên `127.0.0.1` của server để script backup đọc được; máy khác trong LAN không vào thẳng được.

## 2. Chuẩn bị server

| Hạng mục | Khuyến nghị | Ghi chú |
|---|---|---|
| CPU / RAM | 8 vCPU, 32 GB | Máy dev i7-11800H, 31 GB là mức tối thiểu đã đo: video 1 giờ 1080p transcode 18,5 phút |
| Ổ hệ thống | SSD 500 GB | Postgres, Meilisearch, Docker |
| Ổ dữ liệu | HDD/SSD lớn có RAID 1 hoặc RAID 10 | Gắn vào `/srv/luna/minio` (biến `MINIO_DATA_DIR`) |
| Ổ backup | Ổ ngoài hoặc NAS khác máy | Gắn vào `/mnt/luna-backup` (biến `BACKUP_DEST`) |
| UPS | Đủ 10–15 phút để tắt máy an toàn | Mất điện đột ngột có thể hỏng DB |
| Hệ điều hành | Ubuntu Server 24.04 LTS | |

Cài Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # đăng xuất rồi đăng nhập lại
docker compose version          # phải ra v2.x
```

Giới hạn tài nguyên trong `docker-compose.prod.yml` (giả định server 8 core / 32 GB, chỉnh lại khi có server thật):

| Dịch vụ | CPU | RAM | Ghi chú |
|---|---|---|---|
| worker | 4 | 6 GB | ffmpeg chạy `nice 10`, 4 luồng (`FFMPEG_THREADS`, `FFMPEG_NICE`); `DB_STATEMENT_TIMEOUT_MS=300000`; dừng êm tối đa 60 giây |
| tika | 1 | 1,5 GB | JVM `-Xmx1g` |
| gotenberg | 1 | 1 GB | |
| meilisearch | 1 | 2 GB | lập chỉ mục tối đa 1 GB RAM, 1 luồng |
| redis | 0,5 | 1 GB | `maxmemory 768mb`, giữ `noeviction` vì hàng đợi BullMQ cần |
| api, collab, frontend | không giới hạn | không giới hạn | api, collab dừng êm tối đa 30 giây |

Mạng: card mạng của server từ 2,5 GbE trở lên (200 người xem 1080p cùng lúc trong LAN khoảng 1 Gbps); switch LAN tối thiểu 1 GbE tới từng máy.

GPU NVIDIA (tuỳ chọn, transcode nhanh hơn): cài NVIDIA Container Toolkit, đặt `VIDEO_ENCODER=h264_nvenc`.

## 3. Tên miền, HTTPS, đăng nhập Google

1. **DNS công khai (Cloudflare)**: tên miền `lunatech.vn` quản lý trên Cloudflare. Tạo API token quyền *Zone → DNS → Edit* cho `lunatech.vn`, điền vào `CF_DNS_API_TOKEN`. Traefik dùng token này để xin chứng chỉ Let's Encrypt bằng DNS-01, không cần mở cổng ra Internet.
2. **Split DNS trong văn phòng**: trên router hoặc DNS nội bộ, trỏ `knowledge.lunatech.vn` và `media.knowledge.lunatech.vn` về IP LAN của server (ví dụ `192.168.1.20`).
   Kiểm tra từ một máy trong LAN: `nslookup knowledge.lunatech.vn` phải ra IP LAN.
3. **Google Cloud Console** → OAuth client: thêm Authorized redirect URI `https://knowledge.lunatech.vn/api/v1/auth/google/callback`. Điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## 4. Cấu hình

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

Điền các ô trống. Sinh secret:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD, APP_DB_PASSWORD (nằm trong URL nên chỉ dùng chữ và số)
openssl rand -base64 48   # MINIO_ROOT_PASSWORD, MEILI_MASTER_KEY, JWT_ACCESS_SECRET,
                          # COLLAB_TOKEN_SECRET, COLLAB_INTERNAL_SECRET, METRICS_TOKEN, BACKUP_PASSWORD
openssl rand -base64 32   # VIDEO_MASTER_KEY (đúng 32 byte)
```

- Thay `<POSTGRES_PASSWORD>` trong `DATABASE_MIGRATE_URL` và `<MINIO_ROOT_PASSWORD>` ở `S3_SECRET_KEY` bằng mật khẩu thật.
- Thay `<APP_DB_PASSWORD>` trong `DATABASE_URL` bằng một mật khẩu riêng, khác `POSTGRES_PASSWORD`.
- Hai user Postgres: `DATABASE_MIGRATE_URL` là user chủ DB (`POSTGRES_USER`), chỉ dùng cho `migrate` và script backup, restore chạy trên server; compose xoá trắng `DATABASE_MIGRATE_URL`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `BACKUP_PASSWORD` và các token Cloudflare, Grafana trong container api, worker, collab (riêng `S3_SECRET_KEY` hiện vẫn là mật khẩu root MinIO, chưa có user MinIO riêng cho app). `DATABASE_URL` là login riêng của app (`luna_app_user`, thuộc role `luna_app`): đọc ghi dữ liệu được nhưng không tạo hay sửa bảng, không sửa, xoá hay TRUNCATE được `audit_logs`. Bước `migrate` tự tạo login này, và mỗi lần khởi động lại đặt lại mật khẩu theo `DATABASE_URL`, nên đổi mật khẩu chỉ cần sửa `DATABASE_URL` rồi `luna up -d`.
- Mọi bảng phải do user chủ DB tạo (qua migration): quyền mặc định cấp cho `luna_app` gắn với user đó, bảng do user khác tạo thì app không đọc ghi được.
- **Cất `VIDEO_MASTER_KEY` và `BACKUP_PASSWORD` ra một nơi an toàn khác server** (két, trình quản lý mật khẩu của công ty). Mất `VIDEO_MASTER_KEY` thì mọi video đã transcode không phát được nữa; mất `BACKUP_PASSWORD` thì bản backup vô dụng.
- `.env.prod` không bao giờ đưa lên git (đã có trong `.gitignore`).

## 5. Khởi chạy lần đầu

```bash
alias luna='docker compose -f docker/docker-compose.prod.yml --env-file .env.prod'
luna build            # 5–15 phút lần đầu
luna up -d
luna ps               # migrate: Exited (0); các dịch vụ khác: running / healthy
```

Kiểm tra:

```bash
luna ps api collab                                # cột STATUS có chữ (healthy)
curl -s https://knowledge.lunatech.vn/api/v1/me    # {"error":{"code":"UNAUTHENTICATED",...}} nghĩa là HTTPS và API đã thông
```

Mở `https://knowledge.lunatech.vn`, đăng nhập bằng tài khoản Google công ty. Sau đó cấp quyền System Admin cho người quản trị:

```bash
luna run --rm migrate pnpm --filter @luna/scripts admin:grant ten.admin@lunatech.vn
```

Workspace công ty **LunaTech** được tạo bằng seed một lần:

```bash
luna run --rm migrate pnpm --filter @luna/db seed
```

Seed tạo thêm hai workspace demo (Marketing, Engineering); xoá trong trang `/admin → Workspace` nếu không cần.

## 6. Truy cập từ ngoài văn phòng (tuỳ chọn)

1. Cloudflare Zero Trust → Networks → Tunnels → tạo tunnel, chép token vào `CLOUDFLARE_TUNNEL_TOKEN`.
2. Trong tunnel, thêm hai Public Hostname: `knowledge.lunatech.vn` và `media.knowledge.lunatech.vn`, cả hai trỏ tới `https://traefik:443`, bật *No TLS Verify* và đặt *Origin Server Name* đúng hostname tương ứng.
3. `luna --profile remote up -d cloudflared`
4. (Khuyến nghị) Cloudflare Access giới hạn chỉ email `@lunatech.vn`.

Mạng `luna_edge` có subnet cố định (`EDGE_SUBNET`, mặc định `172.30.0.0/24`, gateway `EDGE_GATEWAY`) và container cloudflared có IP cố định `CLOUDFLARED_IP` (mặc định `172.30.0.250`). Traefik chỉ tin header `X-Forwarded-For` từ `CLOUDFLARED_IP`, nên giới hạn tốc độ tính theo IP thật của người dùng từ xa. Đổi ba biến này nếu dải mạng trùng với mạng khác trên server.

Người xem qua tunnel mặc định bị chặn trần 720p (khoảng 3 Mbps mỗi người, `REMOTE_VIDEO_MAX_HEIGHT=720`), vẫn chọn tay được 1080p.

Trần 720p không áp dụng khi trình duyệt phát bằng HLS gốc (Safari trên iPhone, iPad): trình phát gốc của Apple bỏ qua `maxHeight` và tự chọn chất lượng theo mạng, có thể lên 1080p. Người xem từ xa bằng iPhone/iPad vì vậy có thể tốn tới ~5,2 Mbps upload mỗi người; tính dư khi ước lượng băng thông bên dưới.

**Băng thông khi xem video từ xa**: mọi luồng video từ xa đi qua đường **upload** của văn phòng. Mức bitrate: 360p ~0,9 Mbps, 720p ~3 Mbps, 1080p ~5,2 Mbps; trình phát tự hạ chất lượng khi mạng chậm. Đo upload thực tế bằng `speedtest` (hoặc speedtest.net từ một máy trong LAN): ví dụ upload 50 Mbps thì khoảng 8 người xem 1080p cùng lúc từ xa, hoặc 15 người 720p. Người xem trong LAN không tốn băng thông Internet.

Công thức: số người xem từ xa cùng lúc ≈ upload (Mbps) / 3. Ví dụ 10 người cần upload tối thiểu 30 Mbps, 30 người cần 100 Mbps; chọn đường truyền theo số người xem từ xa dự kiến.

## 7. Backup hằng đêm và thử khôi phục

Backup gồm dump Postgres và bucket `originals`, `assets` (preview, thumbnail, HLS tạo lại được từ file gốc), mã hoá bằng `BACKUP_PASSWORD`, giữ `BACKUP_KEEP_DAYS` ngày.

Backup và restore kết nối Postgres bằng `DATABASE_MIGRATE_URL` (user chủ DB); thiếu biến này thì dùng `DATABASE_URL`. Restore tạo sẵn role `luna_app` ở DB đích nếu chưa có, để giữ nguyên quyền của app trong bản dump.

Chạy thử một lần, rồi đặt lịch:

```bash
ENV_FILE=.env.prod bash scripts/backup/backup.sh
crontab -e
# 30 2 * * * cd /opt/luna/backend && ENV_FILE=.env.prod bash scripts/backup/backup.sh >> /var/log/luna-backup.log 2>&1
```

Nên có thêm một bản ra ngoài văn phòng (S3 cloud, NAS chi nhánh): đặt `BACKUP_DEST` là remote rclone tương ứng, xem đầu file `scripts/backup/common.sh`.

**Thử khôi phục mỗi quý** (vào một Postgres trống, không đụng hệ thống đang chạy):

```bash
ENV_FILE=.env.prod bash scripts/backup/restore.sh list
docker run -d --name luna-restore-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:16-alpine
ENV_FILE=.env.prod bash scripts/backup/restore.sh db latest postgresql://postgres:test@localhost:55432/postgres
docker exec luna-restore-test psql -U postgres -c 'select count(*) from nodes'
docker rm -f luna-restore-test
```

## 8. Nâng cấp phiên bản

```bash
git pull
luna build
luna up -d            # migrate chạy trước, rồi các dịch vụ khởi động lại
luna ps
```

Lần đầu nâng cấp lên bản có mạng `edge` subnet cố định phải tắt hết rồi bật lại một lần, vì Compose báo mạng `luna_edge` cần tạo lại (subnet đổi). Phải kèm đủ profile: `luna down` không có `--profile` chỉ tắt dịch vụ lõi, cloudflared (`remote`) và nhóm `monitoring` vẫn chạy, giữ mạng `luna_edge` nên không xoá được.

```bash
luna --profile remote --profile monitoring down
luna up -d
luna --profile remote up -d cloudflared       # nếu dùng truy cập từ xa (mục 6)
luna --profile monitoring up -d               # nếu dùng giám sát (mục 9)
luna --profile remote --profile monitoring ps
```

Dịch vụ gián đoạn trong lúc đó.

Lần đầu nâng cấp lên bản có role DB riêng cho app: trong `.env.prod`, thêm `DATABASE_MIGRATE_URL` bằng đúng giá trị `DATABASE_URL` cũ (user chủ DB), rồi đổi `DATABASE_URL` sang `postgresql://luna_app_user:<APP_DB_PASSWORD>@postgres:5432/luna?schema=public` (mục 4). Không cần tạo user bằng tay: `luna up -d` chạy `migrate`, bước này tạo role `luna_app`, cấp quyền và tạo login `luna_app_user`, xong thì api, worker, collab mới khởi động bằng login đó. Log `luna logs migrate` có dòng `App login luna_app_user created`. Nếu chưa thêm `DATABASE_MIGRATE_URL`, mọi thứ vẫn chạy như cũ bằng user chủ DB (log báo `share the login`), chỉ là chưa có lớp bảo vệ này.

Nên chạy backup ngay trước khi nâng cấp. Nếu bản mới lỗi: `git checkout <commit cũ>`, `luna build && luna up -d`; nếu migration đã đổi DB thì khôi phục từ bản backup vừa chạy.

## 9. Theo dõi và xử lý sự cố

| Việc | Lệnh |
|---|---|
| Trạng thái dịch vụ | `luna ps` |
| Log một dịch vụ | `luna logs -f --tail 200 api` (thay `api` bằng `worker`, `collab`, `traefik`…) |
| Sức khoẻ API, collab | `luna ps` (có `healthy`), chi tiết: `luna exec api node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.text()).then(console.log)"` |
| Metrics Prometheus | Chỉ đọc được trong mạng Docker `luna_internal`: `http://api:4000/metrics`, `http://collab:4001/metrics`, `http://worker:9464/metrics`, kèm header `Authorization: Bearer <METRICS_TOKEN>`. `METRICS_TOKEN` bắt buộc ở production (sinh bằng `openssl rand -base64 32`, collab không khởi động nếu thiếu). Traefik không chuyển tiếp `/collab/metrics` và `/collab/internal/*` ra ngoài |
| Dung lượng ổ | `df -h /srv/luna /var/lib/docker` |
| Dựng lại chỉ mục tìm kiếm | Đăng nhập bằng System Admin rồi gọi `POST /api/v1/admin/search/reindex`; tự chạy lúc 03:30 hằng đêm |

### Giám sát bằng Grafana (profile `monitoring`)

Bật: bắt buộc điền `GRAFANA_ADMIN_PASSWORD` và `METRICS_TOKEN` trong `.env.prod` (để trống thì Grafana, Prometheus từ chối khởi động và in lý do trong `luna logs grafana` hoặc `luna logs prometheus`), rồi `luna --profile monitoring up -d`. Gồm Prometheus (giữ số liệu 30 ngày), Grafana, node-exporter (số liệu máy chủ, chỉ nghe trên cầu nối Docker `EDGE_GATEWAY`, không lộ ra LAN) và cAdvisor (CPU/RAM theo container). Không dịch vụ nào mở cổng ra ngoài trừ Grafana ở `127.0.0.1:3001`.

Nếu server bật tường lửa chặn mặc định (ví dụ ufw `default deny incoming`), phải mở cho Prometheus tới node-exporter: `sudo ufw allow from <EDGE_SUBNET> to <EDGE_GATEWAY> port 9100 proto tcp` (mặc định `sudo ufw allow from 172.30.0.0/24 to 172.30.0.1 port 9100 proto tcp`); thiếu dòng này target `node` trong Prometheus báo down.

Vào Grafana qua SSH tunnel: `ssh -L 3001:127.0.0.1:3001 <server>` rồi mở `http://127.0.0.1:3001` (tài khoản `admin`, mật khẩu `GRAFANA_ADMIN_PASSWORD`), dashboard "Luna overview". Danh sách cảnh báo nằm ở panel "Alerts" của dashboard và ở trang `/alerts` của Prometheus (chạy `luna exec prometheus wget -qO- http://127.0.0.1:9090/api/v1/alerts`).

| Cảnh báo | Điều kiện | Ý nghĩa |
|---|---|---|
| `ApiLatencyP95High` | p95 độ trễ API > 0,3 s trong 5 phút | API chậm, kiểm tra DB, event loop, CPU |
| `Http429Or5xxRatio` | hơn 1% request trả 429 hoặc 5xx trong 5 phút | Quá giới hạn tốc độ hoặc lỗi server |
| `EventLoopLagHigh` | event-loop lag p99 > 0,2 s trong 2 phút | Tiến trình Node bị nghẽn CPU |
| `QueueBacklog` | hơn 100 job `waiting` một hàng đợi trong 10 phút | Worker không theo kịp |
| `HostCpuHigh` | CPU máy chủ > 90% trong 10 phút | Máy chủ quá tải |
| `HostMemoryLow` | RAM khả dụng < 10% trong 5 phút | Nguy cơ OOM |
| `HostNetworkSaturated` | tốc độ gửi của một NIC > 0,8 Gbit/s trong 5 phút | Gần chạm băng thông 1 Gbit/s |
| `TargetDown` | một nguồn số liệu mất kết nối quá 2 phút | Dịch vụ hoặc exporter chết |

Hai panel CPU/RAM theo container cần nhãn `name` từ cAdvisor; nhãn này phụ thuộc storage driver của Docker (với containerd image store, cAdvisor có thể không gắn nhãn và hai panel này trống).

Lưu ý: cảnh báo hiện chỉ hiển thị trên Grafana và Prometheus, chưa gửi đi đâu (chưa có Alertmanager, email hay chat).

Sự cố thường gặp:

- **Trình duyệt báo lỗi chứng chỉ**: `luna logs traefik | grep -i acme`. Thường do `CF_DNS_API_TOKEN` sai quyền hoặc DNS chưa đúng.
- **Đăng nhập Google báo redirect_uri_mismatch**: redirect URI trong Google Console phải khớp tuyệt đối mục 3.
- **Tải file / xem video không được nhưng trang vẫn mở**: kiểm tra `media.knowledge.lunatech.vn` phân giải được và `S3_PUBLIC_ENDPOINT` đúng.
- **Video đứng ở "Đang xử lý"**: `luna logs worker`; worker transcode lần lượt từng video (`VIDEO_TRANSCODE_CONCURRENCY`).
- **Báo lỗi 429 "Too many requests"**: route xem video không bị giới hạn. Nếu người dùng từ xa gặp 429, kiểm tra `CLOUDFLARED_IP` khớp IP thật của container cloudflared (`docker inspect` container cloudflared); nếu sai, mọi người từ xa bị tính chung một IP. Với người dùng trong LAN, có thể một người vượt `RATE_LIMIT_USER_PER_MIN` (mặc định 600 request/phút); tăng nếu cần rồi `luna up -d api`.
- **Nhật ký hoạt động không sửa/xoá được**: bảng `audit_logs` có trigger chỉ cho ghi thêm, chỉ xoá được bản ghi cũ hơn 1 năm. Đây là chủ đích, không phải lỗi.
- **Mất điện xong máy lên lại**: các dịch vụ có `restart: unless-stopped` nên tự chạy; kiểm tra `luna ps` và log Postgres.
