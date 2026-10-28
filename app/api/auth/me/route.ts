import { toErrorResponse } from "@/lib/auth/guard";
import { meHandler } from "@/lib/auth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await meHandler(request);
  } catch (error) {
    return toErrorResponse(error, "auth-me");
  }
}
