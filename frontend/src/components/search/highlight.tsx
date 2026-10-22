import { cn } from "@/lib/cn";
import type { SearchPart } from "@/lib/search";

export function Highlight({ parts, className }: { parts: SearchPart[]; className?: string }) {
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className={cn("rounded-sm bg-amber-100 px-px text-foreground")}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export const plain = (parts: SearchPart[]) => parts.map((p) => p.text).join("");
