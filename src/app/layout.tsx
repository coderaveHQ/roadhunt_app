import type { Metadata, Viewport } from "next";

import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://roadhunt.app"),
  title: {
    default: "Roadhunt",
    template: "%s · Roadhunt",
  },
  description:
    "Find the street on the map – solo or together with friends.",
  applicationName: "Roadhunt",
  openGraph: {
    type: "website",
    siteName: "Roadhunt",
    url: "https://roadhunt.app",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Roadhunt – Kennst du deine Stadt?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101b2b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return children;
}
