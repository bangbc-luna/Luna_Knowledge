export type TokenErrorOutcome = "ended" | "denied" | "retry";

export function tokenErrorOutcome(status: number | undefined): TokenErrorOutcome {
  if (status === 401) return "ended";
  if (status === 403 || status === 404) return "denied";
  return "retry";
}
