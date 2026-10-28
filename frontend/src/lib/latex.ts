export const LATEX_FIELD = "latex";

export interface LatexJSON {
  type: "latex";
  source: string;
}

export function latexSource(json: unknown): string | null {
  return typeof json === "object" && json !== null && (json as { type?: unknown }).type === "latex" && typeof (json as { source?: unknown }).source === "string" ? (json as LatexJSON).source : null;
}
