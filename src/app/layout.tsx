import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Header } from "@/components/Header";

import "./globals.css";

// Stack Sans Headline — the app's display/body typeface (matches the Figma).
// Variable font (weight axis); exposed as --font-stack and wired into the
// Tailwind --font-sans token in globals.css so every element inherits it.
const stackSans = localFont({
  src: "./fonts/StackSansHeadline.ttf",
  variable: "--font-stack",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Try Blond",
  description: "In-chair AI hairstyle try-on for salon staff.",
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
    <html lang="en" className={stackSans.variable}>
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">
        <Header />
        <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4">{children}</main>
      </body>
    </html>
  );
}
