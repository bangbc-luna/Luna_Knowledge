"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface State<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
}

/**
 * Tải dữ liệu khi `deps` đổi; trả trạng thái để vẽ đủ bốn ca (đang tải, có dữ liệu, rỗng, lỗi — I19).
 * `deps` so bằng JSON nên truyền giá trị đơn giản (id, chuỗi lọc), không truyền hàm.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[], { enabled = true } = {}) {
  const key = JSON.stringify(deps);
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: enabled });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [key, enabled, load]);

  const setData = useCallback((update: T | null | ((prev: T | null) => T | null)) => {
    setState((s) => ({ ...s, data: typeof update === "function" ? (update as (p: T | null) => T | null)(s.data) : update }));
  }, []);

  return { data: state.data, setData, error: state.error, loading: state.loading, reload: load };
}
