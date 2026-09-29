import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SCHOOL_CITY, SCHOOL_NAME } from "@/lib/roles";
import "./globals.css";

export const metadata: Metadata = {
  title: `${SCHOOL_NAME}, ${SCHOOL_CITY} | A calmer school day`,
  description: `${SCHOOL_NAME}, ${SCHOOL_CITY} — student management, attendance, exams, and school updates in one place.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
