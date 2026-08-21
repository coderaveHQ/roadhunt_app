import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roadhunt",
    short_name: "Roadhunt",
    description: "Find the street on the map – solo or with friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f3e8",
    theme_color: "#101b2b",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
