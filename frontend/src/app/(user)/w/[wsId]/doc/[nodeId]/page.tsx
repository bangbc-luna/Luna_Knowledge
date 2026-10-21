import { Suspense } from "react";
import { DocumentPage } from "@/components/documents/document-page";

export default function Page() {
  return (
    <Suspense>
      <DocumentPage />
    </Suspense>
  );
}
