import type { Metadata } from "next";
import { Fraunces, Geist_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  // Solo se usa en títulos/wordmark — un par de pesos alcanza, no toda la
  // familia variable.
  weight: ["500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIGE · CESP",
  description: "Sistema de Gestión Escolar — CESP",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${publicSans.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
