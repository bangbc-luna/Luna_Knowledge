"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "./api";

export function useThumbnail(src: string | null): string | null {
  const [state, setState] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!src) return;
    let objectUrl: string | null = null;
    let alive = true;
    fetch(src, { headers: authHeaders() })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!alive || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ src, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return src && state?.src === src ? state.url : null;
}
