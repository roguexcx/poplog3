import { uiMessage } from "@/lib/i18n/ui-message";
import RadarCacheClient from "./RadarCacheClient";
export const metadata = {
    title: uiMessage("ui.b138dd12d03a"),
};
export default function RadarCachePage() {
    return <RadarCacheClient />;
}

