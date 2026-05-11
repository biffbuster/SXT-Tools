import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SXT Tools — AI agent skills for Space and Time",
  description: "Five protocol-aware skills compose a publish-and-prove pipeline that takes a CSV from a local file to a Base-mainnet event a smart contract can verify cryptographically.",
  keywords: ["SXT Tools", "Space and Time", "Proof of SQL", "Claude Code", "AI agents", "skills", "blockchain", "smart contracts", "Base", "Ethereum"],
  authors: [{ name: "SXT Tools" }],
  openGraph: {
    title: "SXT Tools",
    description: "AI agent skills for Space and Time — publish chain-secured datasets, deploy contracts, run Proof of SQL queries that any smart contract can verify onchain.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SXT Tools",
    description: "AI agent skills for Space and Time — publish, prove, verify onchain.",
  },
};

// Runs synchronously before React hydrates so the theme is set pre-paint (no flash).
// Default is light; persisted preference in localStorage wins.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
