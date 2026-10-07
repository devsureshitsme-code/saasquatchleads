import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/schibsted-grotesk/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'SaaSquatchLeads',
  description: 'Turn a raw lead list into a clean, verified, ranked call list.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#090b11',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
