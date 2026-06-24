import { reorderUserLists } from "@/server/lists/list-service";
import { jsonError, jsonSuccess, readJsonObject, requireListUser, stringIds } from "../_shared";

export async function POST(request: Request) {
  const context = { method: "POST", path: "/api/lists/reorder", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const body = await readJsonObject(request);
    await reorderUserLists({
      userId: auth.user.id,
      orderedIds: stringIds(body.orderedIds, "orderedIds"),
    });
    return jsonSuccess(context, null);
  } catch (error) {
    return jsonError(context, error);
  }
}
