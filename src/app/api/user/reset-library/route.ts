import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const userId = user.id;

  await db.$transaction([
    db.userEpisode.deleteMany({ where: { userId } }),
    db.heroSpotlightSession.deleteMany({ where: { userId } }),
    db.userTitleState.deleteMany({ where: { userId } }),
    db.userRating.deleteMany({ where: { userId } }),
    db.userTitleFeedback.deleteMany({ where: { userId } }),
    db.userCuradoriaSignal.deleteMany({ where: { userId } }),
    db.userCuradoriaPreference.deleteMany({ where: { userId } }),
    db.userCuradoriaState.deleteMany({ where: { userId } }),
    db.userEvent.deleteMany({ where: { userId } }),
    db.userWatching.deleteMany({ where: { userId } }),
    db.userTitle.deleteMany({ where: { userId } }),
    db.continuitySectionCache.deleteMany({ where: { userId } }),
  ]);

  return NextResponse.json({ ok: true });
}
