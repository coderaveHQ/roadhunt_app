export type PublicSupabaseConfig = {
  url: string;
  publishableKey: string;
};

export type SecretSupabaseConfig = PublicSupabaseConfig & {
  secretKey: string;
};

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Local Supabase is configured with a loopback URL so server-side requests stay
 * on the Mac. A browser opened through the Mac's LAN address must use that same
 * LAN hostname for Auth and Realtime instead of resolving 127.0.0.1 on the
 * phone itself.
 */
export function resolveBrowserSupabaseUrl(configuredUrl: string, browserHostname: string) {
  const url = new URL(configuredUrl);
  if (loopbackHostnames.has(url.hostname) && !loopbackHostnames.has(browserHostname)) {
    url.hostname = browserHostname;
  }
  return url.toString().replace(/\/$/, "");
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function getSecretSupabaseConfig(): SecretSupabaseConfig | null {
  const publicConfig = getPublicSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!publicConfig || !secretKey) return null;
  return { ...publicConfig, secretKey };
}

export function hasSupabaseConfig() {
  return getSecretSupabaseConfig() !== null;
}
