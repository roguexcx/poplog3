import { getUserListDetail, removeTitleFromList } from "@/server/lists/list-service";
import {
  jsonError,
  jsonSuccess,
  readJsonObject,
  requireListUser,
  resolveTitleFromPayload,
} from "@/app/api/lists/_shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const context = { method: "GET", path: "/api/lists/[id]/items", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    return jsonSuccess(context, await getUserListDetail({ userId: auth.user.id, listId: id }));
  } catch (error) {
    return jsonError(context, error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const context = { method: "DELETE", path: "/api/lists/[id]/items", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const [{ id }, body] = await Promise.all([params, readJsonObject(request)]);
    const title = await resolveTitleFromPayload(body);
    await removeTitleFromList({ userId: auth.user.id, listId: id, ...title });
    return jsonSuccess(context, null);
  } catch (error) {
    return jsonError(context, error);
  }
}
