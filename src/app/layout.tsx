import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DreamSpace SDK — One Powerful SDK for Onchain Development",
  description: "Build production-grade Web3 apps with TypeScript. Query blockchain data, deploy smart contracts, and ship to DreamSpace — all from your terminal.",
  keywords: ["DreamSpace", "SDK", "Web3", "TypeScript", "blockchain", "smart contracts", "Space and Time", "Base", "Coinbase"],
  authors: [{ name: "MakeInfinite Labs" }],
  openGraph: {
    title: "DreamSpace SDK",
    description: "One Powerful SDK for Onchain Development",
    type: "website",
    url: "https://dream.space",
  },
  twitter: {
    card: "summary_large_image",
    title: "DreamSpace SDK",
    description: "Build production-grade Web3 apps with TypeScript",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Space+Grotesk:wght@300..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
