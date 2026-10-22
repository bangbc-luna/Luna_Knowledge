import { Suspense } from "react";
import { SearchPage } from "@/components/search/search-page";

export default function Page() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
