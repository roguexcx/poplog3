import {
  ListServiceError,
  createUserList,
  getUserListSummaries,
  serializeUserListRecord,
} from "@/server/lists/list-service";
import { jsonError, jsonSuccess, readJsonObject, requireListUser } from "./_shared";

export async function GET() {
  const context = { method: "GET", path: "/api/lists", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    return jsonSuccess(context, await getUserListSummaries(auth.user.id));
  } catch (error) {
    return jsonError(context, error);
  }
}

export async function POST(request: Request) {
  const context = { method: "POST", path: "/api/lists", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const body = await readJsonObject(request);
    if (typeof body.name !== "string") {
      throw new ListServiceError("name must be a string", 400);
    }
    if (body.description !== undefined && body.description !== null && typeof body.description !== "string") {
      throw new ListServiceError("description must be a string or null", 400);
    }
    const list = await createUserList({
      userId: auth.user.id,
      name: body.name,
      description: body.description as string | null | undefined,
    });
    return jsonSuccess(context, serializeUserListRecord(list), 201);
  } catch (error) {
    return jsonError(context, error);
  }
}
