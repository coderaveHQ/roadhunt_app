import { describe, expect, it } from "vitest";

import { resolveBrowserSupabaseUrl } from "../../src/lib/supabase/env";

describe("browser Supabase URL resolution", () => {
  it("uses the page's LAN hostname for a loopback local Supabase URL", () => {
    expect(resolveBrowserSupabaseUrl("http://127.0.0.1:55321", "192.168.1.42"))
      .toBe("http://192.168.1.42:55321");
  });

  it("keeps loopback for a browser running on the development machine", () => {
    expect(resolveBrowserSupabaseUrl("http://127.0.0.1:55321", "localhost"))
      .toBe("http://127.0.0.1:55321");
  });

  it("never rewrites a configured production Supabase host", () => {
    expect(resolveBrowserSupabaseUrl("https://project.supabase.co", "roadhunt.app"))
      .toBe("https://project.supabase.co");
  });
});
