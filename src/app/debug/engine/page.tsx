import { uiMessage } from "@/lib/i18n/ui-message";
import EngineMonitorClient from "./EngineMonitorClient";
export const metadata = {
    title: uiMessage("ui.a92056bdb7c3"),
};
export default function EngineMonitorPage() {
    return <EngineMonitorClient />;
}

