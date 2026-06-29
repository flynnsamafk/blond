import type { Metadata, Viewport } from "next";

import { Header } from "@/components/Header";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Hairstyle Test",
  description: "Upload a customer photo + reference hairstyle and generate a studio profile.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4">{children}</main>
      </body>
    </html>
  );
}
