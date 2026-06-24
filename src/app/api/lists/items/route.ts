import { ListServiceError, addTitleToLists } from "@/server/lists/list-service";
import {
  jsonError,
  jsonSuccess,
  readJsonObject,
  requireListUser,
  resolveTitleFromPayload,
  stringIds,
} from "../_shared";

export async function POST(request: Request) {
  const context = { method: "POST", path: "/api/lists/items", startedAt: Date.now() };
  const auth = await requireListUser(context);
  if (auth.response) return auth.response;

  try {
    const body = await readJsonObject(request);
    if (body.alsoAddToWatchlist !== undefined && typeof body.alsoAddToWatchlist !== "boolean") {
      throw new ListServiceError("alsoAddToWatchlist must be a boolean", 400);
    }
    const title = await resolveTitleFromPayload(body);
    const result = await addTitleToLists({
      userId: auth.user.id,
      ...title,
      listIds: stringIds(body.listIds, "listIds"),
      alsoAddToWatchlist: body.alsoAddToWatchlist as boolean | undefined,
    });
    return jsonSuccess(context, result, 201);
  } catch (error) {
    return jsonError(context, error);
  }
}
