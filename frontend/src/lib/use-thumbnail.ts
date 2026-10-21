"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "./api";

export function useThumbnail(nodeId: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let alive = true;
    fetch(`/api/v1/files/${nodeId}/thumbnail`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!alive || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [nodeId, enabled]);
  return enabled ? url : null;
}
