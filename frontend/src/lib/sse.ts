import { authHeaders, refreshSession } from "./api";

export function subscribeSse<T>(path: string, onEvent: (type: string, data: T) => void): () => void {
  const controller = new AbortController();
  let stopped = false;
  let delay = 1000;

  const run = async () => {
    while (!stopped) {
      try {
        const res = await fetch(`/api/v1${path}`, {
          headers: { Accept: "text/event-stream", ...authHeaders() },
          signal: controller.signal,
        });
        if (res.status === 401 && (await refreshSession())) continue;
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let type = "message";
            const data: string[] = [];
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) type = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trim());
            }
            if (data.length) {
              try {
                onEvent(type, JSON.parse(data.join("\n")) as T);
              } catch {
              }
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    controller.abort();
  };
}
