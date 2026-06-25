import { uiMessage } from "@/lib/i18n/ui-message";
import AdminClient from "./AdminClient";
export const metadata = {
    title: uiMessage("ui.c20d42d624fa"),
};
export default function AdminPage() {
    return <AdminClient />;
}

