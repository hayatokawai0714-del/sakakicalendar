import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "出荷・予定管理", description: "社内カレンダー" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <main className="mx-auto max-w-3xl p-4 pb-20">
          {children}
        </main>
        <nav className="fixed bottom-0 left-0 right-0 mx-auto flex max-w-3xl justify-around border-t bg-white p-3 text-xs">
          <Link href="/">ホーム</Link><Link href="/calendar">カレンダー</Link><Link href="/destinations">出荷先</Link><Link href="/settings/units">規格/単位</Link>
        </nav>
      </body>
    </html>
  );
}

