import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';

/**
 * Trang thử phát video (PLAN Phase 4, chỉ ở NODE_ENV=development): đăng nhập persona bằng /dev/token,
 * xin phiên xem, phát bằng hls.js, phủ watermark tên + email + giờ, lưu vị trí xem dở.
 * Trình phát thật của FE làm sau; trang này chỉ để kiểm luồng API.
 */
@ApiExcludeController()
@Public()
@Controller('dev')
export class DevPlayerController {
  @Get('player')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  page() {
    return PAGE;
  }
}

const PAGE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Luna dev player</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 16px;color:#1f2328}
  input,button{font:inherit;padding:6px 10px;border:1px solid #d0d7de;border-radius:6px}
  button{background:#1f6feb;color:#fff;border-color:#1f6feb;cursor:pointer}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px} .row input{flex:1;min-width:220px}
  .stage{position:relative;background:#000;border-radius:8px;overflow:hidden;aspect-ratio:16/9}
  video{width:100%;height:100%;display:block}
  .wm{position:absolute;pointer-events:none;color:#fff;opacity:.18;font-size:14px;font-weight:600;white-space:nowrap;text-shadow:0 0 2px #000;transition:top .6s,left .6s}
  pre{background:#f6f8fa;padding:10px;border-radius:6px;white-space:pre-wrap;font-size:13px;max-height:220px;overflow:auto}
</style></head><body>
<h1>Phát thử video</h1>
<div class="row"><input id="email" value="qa.owner@lunatech.vn" aria-label="Email persona">
<input id="node" placeholder="ID của mục VIDEO" aria-label="ID video"><button id="go">Phát</button></div>
<div class="stage"><video id="v" controls playsinline></video><div class="wm" id="wm"></div></div>
<pre id="log"></pre>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js"></script>
<script>
const $ = (id) => document.getElementById(id);
const log = (m) => { $('log').textContent = new Date().toLocaleTimeString() + ' ' + m + '\\n' + $('log').textContent; };
$('node').value = new URLSearchParams(location.search).get('id') || '';
let hls, timer, save;
$('go').onclick = async () => {
  clearInterval(timer); clearInterval(save); hls?.destroy();
  const t = await (await fetch('/api/v1/dev/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('email').value }) })).json();
  const auth = { Authorization: 'Bearer ' + t.accessToken };
  const id = $('node').value.trim();
  const res = await fetch('/api/v1/videos/' + id + '/playback', { method: 'POST', headers: auth });
  const pb = await res.json();
  if (!res.ok) return log('playback: ' + res.status + ' ' + JSON.stringify(pb.error));
  log('phiên xem ' + pb.token.slice(0, 8) + '…, thời lượng ' + pb.durationSec.toFixed(1) + 's, xem tiếp từ ' + (pb.resumeAt ?? 0));
  const v = $('v');
  if (pb.posterUrl) v.poster = pb.posterUrl;
  const moveWm = () => {
    $('wm').textContent = pb.watermark.name + ' · ' + pb.watermark.email + ' · ' + new Date().toLocaleString('vi-VN');
    $('wm').style.left = (5 + Math.random() * 55) + '%'; $('wm').style.top = (5 + Math.random() * 80) + '%';
  };
  moveWm(); timer = setInterval(moveWm, 30000);
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => log('bậc chất lượng: ' + d.levels.map((l) => l.height + 'p').join(', ')));
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => log('đang phát ' + hls.levels[d.level].height + 'p'));
    hls.on(Hls.Events.ERROR, (_, d) => log('lỗi hls: ' + d.details + (d.fatal ? ' (fatal)' : '')));
    hls.loadSource(pb.masterUrl); hls.attachMedia(v);
  } else { v.src = pb.masterUrl; }
  if (pb.resumeAt) v.currentTime = pb.resumeAt;
  save = setInterval(() => !v.paused && fetch('/api/v1/videos/' + id + '/progress', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ positionSec: v.currentTime }) }), 10000);
};
if ($('node').value) $('go').click();
</script></body></html>`;
