import assert from "node:assert/strict";

import { AD_PLACEMENTS, type AdSlotPlacement } from "@/lib/ads/config";

const expected: AdSlotPlacement[] = [
  "home_between_blocks",
  "home_after_rankings",
  "list_between_results",
  "title_after_main_content",
  "radar_between_groups",
  "library_between_groups",
  "sidebar_contextual",
];

for (const placement of expected) {
  const config = AD_PLACEMENTS[placement];
  assert.ok(config, `${placement} configurado`);
  assert.equal(config.enabledByDefault, false, `${placement} desligado por padrao`);
  assert.ok(config.envSlot.startsWith("NEXT_PUBLIC_ADSENSE_SLOT_"), `${placement} slot por env`);
  assert.ok(config.minHeight >= 90 || placement === "sidebar_contextual", `${placement} reserva desktop definida`);
  assert.ok(config.mobileMinHeight >= 0, `${placement} reserva mobile definida`);
  assert.ok(config.description.length > 20, `${placement} decisao de produto documentada`);
}

console.log("[smoke:ads-placement] ok", { placements: expected.length });
