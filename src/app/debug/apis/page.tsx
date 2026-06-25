import { uiMessage } from "@/lib/i18n/ui-message";
import ApiDebugClient from "./ApiDebugClient";
export const metadata = {
    title: uiMessage("ui.c0fd0545d118"),
    description: uiMessage("ui.24e42ce09060"),
};
export default function ApiDebugPage() {
    return <ApiDebugClient />;
}

