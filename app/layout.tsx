import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat with a Website",
  description: "Crawl a website and ask grounded questions with source links."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
