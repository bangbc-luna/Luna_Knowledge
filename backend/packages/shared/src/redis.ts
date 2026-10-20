/** BullMQ nhận cấu hình ioredis dạng object, không nhận URL. */
export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Bắt buộc với worker BullMQ: lệnh blocking không được tự hủy sau N lần retry.
    maxRetriesPerRequest: null,
  };
}
