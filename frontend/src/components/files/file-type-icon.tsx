import { Clapperboard, File, FileChartColumn, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { fileKind } from "@/lib/files";

export function FileTypeIcon({ name, mime, className }: { name: string; mime?: string | null; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (fileKind(name, mime)) {
    case "pdf":
    case "word":
    case "text":
      return <FileText {...props} />;
    case "sheet":
      return <FileSpreadsheet {...props} />;
    case "slide":
      return <FileChartColumn {...props} />;
    case "image":
      return <FileImage {...props} />;
    case "video":
      return <Clapperboard {...props} />;
    default:
      return <File {...props} />;
  }
}
