import { toErrorResponse } from "@/lib/auth/guard";
import { changePasswordHandler } from "@/lib/auth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await changePasswordHandler(request);
  } catch (error) {
    return toErrorResponse(error, "auth-password");
  }
}
