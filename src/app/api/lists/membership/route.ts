import { getUserListMembership } from "@/server/lists/list-service";
import {
  jsonError,
  jsonSuccess,
  parseMembershipTitles,
  requireListUser,
} from "../_shared";

export async function GET(request: Request) {
  const context = { method: "GET", path: "/api/lists/membership", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const titles = parseMembershipTitles(new URL(request.url).searchParams.get("titles"));
    const membership = await getUserListMembership({ userId: auth.user.id, titles });
    return jsonSuccess(context, Object.fromEntries(membership));
  } catch (error) {
    return jsonError(context, error);
  }
}
