import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import {
  mergeSessionResponse,
  refreshSupabaseSession,
} from "@/lib/supabase/proxy";

const handleI18n = createMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const sessionResponse = await refreshSupabaseSession(request);
  const i18nResponse = handleI18n(request);
  return mergeSessionResponse(i18nResponse, sessionResponse);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
