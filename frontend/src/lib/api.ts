/**
 * Gọi backend qua /api/v1 (Next rewrites → localhost:4000, cùng origin nên cookie refresh tự gửi).
 * Access token giữ trong bộ nhớ (không localStorage): đóng tab là mất, đúng yêu cầu "mỗi lần vào đăng nhập lại".
 * Token hết hạn (401 UNAUTHENTICATED) thì tự refresh một lần rồi gọi lại.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; avatarUrl: string | null; isSystemAdmin: boolean };
}

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let refreshing: Promise<TokenResponse | null> | null = null;
let onSessionLost: ((code: string) => void) | null = null;

export function setSession(token: TokenResponse | null) {
  accessToken = token?.accessToken ?? null;
  tokenExpiresAt = token ? Date.now() + token.expiresIn * 1000 : 0;
}
/** Header Authorization cho các lệnh gọi tự dựng (SSE, ảnh cần đăng nhập). */
export const authHeaders = (): Record<string, string> => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {});
export const tokenSecondsLeft = () => Math.max(0, Math.round((tokenExpiresAt - Date.now()) / 1000));
export function onSessionExpired(handler: (code: string) => void) {
  onSessionLost = handler;
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; details?: unknown; requestId?: string };
  } | null;
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText, e?.details, e?.requestId);
}

/** Đổi refresh cookie lấy access token. Nhiều request cùng hết hạn thì chỉ refresh một lần. */
export function refreshSession(): Promise<TokenResponse | null> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then(async (res) => {
      // 204 = chưa đăng nhập (không có cookie), 401 = phiên hết hạn / bị thu hồi.
      if (!res.ok || res.status === 204) {
        setSession(null);
        return null;
      }
      const token = (await res.json()) as TokenResponse;
      setSession(token);
      return token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export async function api<T = unknown>(
  path: string,
  { method = "GET", body, query, raw = false }: { method?: string; body?: unknown; query?: Query; raw?: boolean } = {},
): Promise<T> {
  const send = () =>
    fetch(withQuery(`/api/v1${path}`, query), {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send();
  if (res.status === 401) {
    const err = await parseError(res.clone());
    if (err.code === "UNAUTHENTICATED" && (await refreshSession())) {
      res = await send();
    } else if (err.code === "SESSION_EXPIRED" || err.code === "UNAUTHENTICATED") {
      onSessionLost?.(err.code);
      throw err;
    }
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401) onSessionLost?.(err.code);
    throw err;
  }
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Tải tệp (CSV) bằng token hiện tại rồi lưu bằng thẻ a tạm. */
export async function downloadFile(path: string, query: Query, fallbackName: string) {
  const res = await api<Response>(path, { query, raw: true });
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Câu báo lỗi cho người dùng: thông điệp + mã + requestId để tra log. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code}${err.requestId ? ` · req ${err.requestId.slice(0, 8)}` : ""})`;
  return err instanceof Error ? err.message : String(err);
}
