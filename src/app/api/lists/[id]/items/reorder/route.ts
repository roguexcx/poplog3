import { reorderUserListItems } from "@/server/lists/list-service";
import { jsonError, jsonSuccess, readJsonObject, requireListUser, stringIds } from "../../../_shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const context = { method: "POST", path: "/api/lists/[id]/items/reorder", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const [{ id }, body] = await Promise.all([params, readJsonObject(request)]);
    await reorderUserListItems({
      userId: auth.user.id,
      listId: id,
      orderedItemIds: stringIds(body.orderedItemIds, "orderedItemIds"),
    });
    return jsonSuccess(context, null);
  } catch (error) {
    return jsonError(context, error);
  }
}
