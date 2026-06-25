import { uiMessage } from "@/lib/i18n/ui-message";
import PageShell from "@/components/layout/PageShell";
export default function UserListLoading() {
    return (<PageShell variant="wide">
      <div className="animate-pulse space-y-8 pb-20" aria-label={uiMessage("ui.22aca24afa95")}>
        <div className="h-64 rounded-[2rem] border border-white/[0.06] bg-white/[0.035]"/>
        <div className="h-14 rounded-[1.35rem] border border-white/[0.05] bg-white/[0.025]"/>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="aspect-[2/3] rounded-[1.35rem] bg-white/[0.035]"/>)}
        </div>
      </div>
    </PageShell>);
}

