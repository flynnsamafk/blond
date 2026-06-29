/**
 * Nested layout for the isolated `/lab/*` sandbox.
 *
 * Wraps every lab page with a sidebar for navigation, sitting INSIDE the root
 * layout (which still provides the app Header + main container). This file is the
 * only place the sidebar is mounted, so the working tester at `/` never sees it.
 * Pure presentation — no data, no network, no Gemini.
 */

import { LabSidebar } from "@/components/lab/LabSidebar";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <LabSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
