import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 38,
        background: "#101b2b",
        color: "#ff5a36",
        fontSize: 92,
        fontWeight: 900,
        letterSpacing: -8,
      }}
    >
      RH
    </div>,
    size,
  );
}
