"use client";

import { UploadTray } from "@/components/files/upload-tray";
import { AppFrame } from "@/components/shell/shell";
import { Guard } from "@/components/shell/guard";
import { UserSidebar } from "@/components/shell/user-sidebar";
import { VideoUploadPrompt } from "@/components/videos/video-info-dialog";
import { UploadProvider } from "@/lib/uploads";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <Guard>
      <UploadProvider>
        <AppFrame sidebar={<UserSidebar />} members>{children}</AppFrame>
        <UploadTray />
        <VideoUploadPrompt />
      </UploadProvider>
    </Guard>
  );
}
