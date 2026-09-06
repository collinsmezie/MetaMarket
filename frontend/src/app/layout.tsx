import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientLoggerInit } from '@/components/ClientLoggerInit';

export const metadata: Metadata = {
  title: 'MetaMarket',
  description: 'Instant Universal Market Translation & Discovery Engine',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0b141a] text-slate-100 h-full antialiased font-sans overscroll-none select-none">
        <ClientLoggerInit />
        {children}
      </body>
    </html>
  );
}
