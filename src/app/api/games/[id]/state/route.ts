import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentPlayerId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) {
    return Response.json({ error: "invalid_game" }, { status: 400 });
  }

  const [admin, userId] = [getSupabaseAdminClient(), await getCurrentPlayerId()];
  if (!admin) {
    return Response.json({ error: "backend_unavailable" }, { status: 503 });
  }
  if (!userId) {
    return Response.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { data, error } = await admin.rpc("get_game_state", {
    p_game_id: parsedId.data,
    p_user_id: userId,
  });
  if (error) {
    return Response.json({ error: "request_failed" }, { status: 400 });
  }

  return Response.json(data, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
