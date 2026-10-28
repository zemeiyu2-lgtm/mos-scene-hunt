import { toErrorResponse } from "@/lib/auth/guard";
import { logoutHandler } from "@/lib/auth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await logoutHandler(request);
  } catch (error) {
    return toErrorResponse(error, "auth-logout");
  }
}
