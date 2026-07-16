import "./globals.css";

export const metadata = {
  title: "InnoPulse Full-Scale — The Growth System",
  description: "Corporate innovation-diagnostic platform (preview build)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          {children}
          <div className="footer">
            InnoPulse Full-Scale · preview build · The Growth System
          </div>
        </div>
      </body>
    </html>
  );
}
