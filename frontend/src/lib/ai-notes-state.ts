export interface AiNotesUpdate {
  enabled: boolean;
  version?: number;
}

export interface AiNotesState {
  enabled: boolean;
  version: number;
}

function parseJson(raw: string | Uint8Array | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function update(enabled: unknown, version: unknown): AiNotesUpdate | null {
  if (typeof enabled !== "boolean") return null;
  return typeof version === "number" && Number.isInteger(version) ? { enabled, version } : { enabled };
}

export function aiNotesFromMetadata(raw: string | undefined): AiNotesUpdate | null {
  const meta = parseJson(raw);
  return meta ? update(meta.aiNotesEnabled, meta.version) : null;
}

export function aiNotesFromPacket(payload: Uint8Array): AiNotesUpdate | null {
  const msg = parseJson(payload);
  return msg?.type === "ai_notes" ? update(msg.enabled, msg.version) : null;
}

export function acceptAiNotes(current: AiNotesState, incoming: AiNotesUpdate): AiNotesState {
  if (incoming.version === undefined && !incoming.enabled) return current;
  if (incoming.version !== undefined && incoming.version < current.version) return current;
  return { enabled: incoming.enabled, version: incoming.version ?? current.version };
}
