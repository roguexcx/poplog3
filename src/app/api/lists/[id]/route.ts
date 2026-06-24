import {
  ListServiceError,
  deleteUserList,
  serializeUserListRecord,
  updateUserList,
} from "@/server/lists/list-service";
import { jsonError, jsonSuccess, readJsonObject, requireListUser } from "../_shared";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const context = { method: "PATCH", path: "/api/lists/[id]", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const body = await readJsonObject(request);
    if (body.name === undefined && body.description === undefined) {
      throw new ListServiceError("name or description is required", 400);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      throw new ListServiceError("name must be a string", 400);
    }
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
      throw new ListServiceError("description must be a string or null", 400);
    }
    const list = await updateUserList({
      userId: auth.user.id,
      listId: id,
      name: body.name as string | undefined,
      description: body.description as string | null | undefined,
    });
    return jsonSuccess(context, serializeUserListRecord(list));
  } catch (error) {
    return jsonError(context, error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const context = { method: "DELETE", path: "/api/lists/[id]", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    await deleteUserList({ userId: auth.user.id, listId: id });
    return jsonSuccess(context, null);
  } catch (error) {
    return jsonError(context, error);
  }
}
