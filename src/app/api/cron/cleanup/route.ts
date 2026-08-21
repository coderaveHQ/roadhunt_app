import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return Response.json({ ok: false, error: "backend_unavailable" }, { status: 503 });
  }

  const { data, error } = await admin.rpc("cleanup_expired_data", {
    p_delete_anonymous_users: false,
  });
  if (error) {
    console.error("Roadhunt cleanup failed", error.code);
    return Response.json({ ok: false, error: "cleanup_failed" }, { status: 500 });
  }

  return Response.json({ ok: true, result: data });
}
