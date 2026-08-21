import { networkInterfaces } from "node:os";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const allowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  ...Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address),
  ),
];

export default withNextIntl({
  allowedDevOrigins,
  poweredByHeader: false,
  reactStrictMode: true,
});
