import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50% 50% 50% 12%",
        background: "#ff5a36",
        color: "#101b2b",
        border: "3px solid #101b2b",
        fontSize: 18,
        fontWeight: 900,
      }}
    >
      R
    </div>,
    size,
  );
}
