import "./globals.css";
import "./completion.css";
import { Inter, Fraunces } from "next/font/google";

// Self-hosted via next/font (CSP-safe): Inter for UI, Fraunces for display headings.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: "InnoPulse Full-Scale — The Growth System",
  description: "Understand innovation capability, review evidence and turn insight into action.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
