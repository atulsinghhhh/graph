import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'Graph — AI Incident Investigation',
  description: 'AI-powered incident investigation over a live graph of your deployments, PRs, engineers, and incidents.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark scroll-smooth ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: 'dark' }}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
