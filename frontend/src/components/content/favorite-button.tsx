"use client";

import { Star } from "lucide-react";
import { api, describeError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { NodeItem } from "@/lib/types";
import { ICON_BUTTON_SIZES } from "../ui/button";
import { useToast } from "../ui/toast";

export function FavoriteButton({ node, onChange }: { node: NodeItem; onChange: (fav: boolean) => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={node.isFavorite ? "Bỏ yêu thích" : "Yêu thích"}
      aria-pressed={node.isFavorite}
      onClick={async () => {
        const next = !node.isFavorite;
        onChange(next);
        try {
          await api(`/nodes/${node.id}/favorite`, { method: next ? "PUT" : "DELETE" });
        } catch (err) {
          onChange(!next);
          toast("error", describeError(err));
        }
      }}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center outline-hidden transition-colors hover:bg-foreground/8",
        ICON_BUTTON_SIZES.touch,
        node.isFavorite ? "text-foreground" : "text-muted/60 hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", node.isFavorite && "fill-current")} aria-hidden />
    </button>
  );
}
