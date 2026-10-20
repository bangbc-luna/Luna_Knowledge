/** Ghép class có điều kiện (không dùng thư viện: class trong dự án không chồng chéo nhau). */
export function cn(...parts: Array<string | number | false | null | undefined>): string {
  return parts.filter((p) => typeof p === "string" && p).join(" ");
}
