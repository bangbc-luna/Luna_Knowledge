import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';

@ApiExcludeController()
@Public()
@Controller('dev')
export class DevLoginController {
  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page() {
    return PAGE;
  }
}

const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Luna dev login</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2328}
  a.btn,button{display:inline-block;padding:8px 14px;border-radius:6px;border:1px solid #d0d7de;background:#f6f8fa;color:inherit;text-decoration:none;cursor:pointer;font:inherit}
  a.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
  pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-all}
  .err{color:#cf222e}
</style></head><body>
<h1>Luna Knowledge · đăng nhập thử (dev)</h1>
<p id="status">Đang kiểm tra phiên…</p>
<p>
  <a class="btn primary" href="/api/v1/auth/google">Đăng nhập bằng Google</a>
  <button id="refresh">Lấy access token mới</button>
  <button id="logout">Đăng xuất</button>
  <a class="btn" href="/api/docs" target="_blank">Mở Swagger</a>
</p>
<h3>Access token <button id="copy">Copy</button></h3>
<pre id="token">—</pre>
<h3>GET /api/v1/me</h3>
<pre id="me">—</pre>
<script>
const $ = (id) => document.getElementById(id);
const err = new URLSearchParams(location.search).get('error');
let token = null;
async function refresh() {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  const body = await res.json();
  if (!res.ok) {
    token = null;
    $('status').innerHTML = err ? '<span class="err">Đăng nhập thất bại: ' + err + '</span>' : 'Chưa đăng nhập (' + body.error.code + ').';
    $('token').textContent = '—'; $('me').textContent = '—';
    return;
  }
  token = body.accessToken;
  $('status').textContent = 'Đã đăng nhập: ' + body.user.email + ' · token hết hạn sau ' + body.expiresIn + 's';
  $('token').textContent = token;
  const me = await fetch('/api/v1/me', { headers: { Authorization: 'Bearer ' + token } });
  $('me').textContent = JSON.stringify(await me.json(), null, 2);
}
$('refresh').onclick = refresh;
$('logout').onclick = async () => {
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: token ? { Authorization: 'Bearer ' + token } : {} });
  history.replaceState(null, '', location.pathname); location.reload();
};
$('copy').onclick = () => token && navigator.clipboard.writeText(token);
refresh();
</script>
</body></html>`;
