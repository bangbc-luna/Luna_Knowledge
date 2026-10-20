import { Suspense } from "react";
import { LogsPage } from "@/components/admin/logs-page";

export default function Page() {
  return (
    <Suspense>
      <LogsPage />
    </Suspense>
  );
}
