"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { X } from "lucide-react";
import { API_SOURCES } from "@/attribution/api-sources";
import SourceLogo from "./SourceLogo";
type AttributionModalProps = {
    open: boolean;
    onClose: () => void;
};
export default function AttributionModal({ open, onClose, }: AttributionModalProps) {
    if (!open)
        return null;
    const sources = Object.values(API_SOURCES);
    return (<div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/68 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6" role="dialog" aria-modal="true" aria-label={uiMessage("ui.4a4a71aac1d0")} onMouseDown={onClose}>
      <div className="relative max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-[1.5rem] border border-white/[0.10] bg-[#09090f] shadow-[0_24px_90px_rgba(0,0,0,0.62)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent"/>

        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/55 transition hover:border-white/[0.20] hover:bg-white/[0.08] hover:text-white" aria-label={uiMessage("ui.28d8c482dacc")}>
          <X size={17}/>
        </button>

        <div className="max-h-[88vh] overflow-y-auto p-5 sm:p-7">
          <div className="pr-10">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200/55">
              POPLOG
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">{uiMessage("ui.00cab8f4b69a")}</h2>
            <p className="mt-3 max-w-2xl text-[13px] leading-6 text-white/48">{uiMessage("ui.84b1ee8a1f1a")}</p>
          </div>

          <div className="mt-6 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.07] bg-white/[0.025]">
            {sources.map((source) => (<a key={source.id} href={source.officialUrl} target="_blank" rel="noreferrer noopener" className="group/source flex gap-4 p-4 transition hover:bg-white/[0.035] sm:items-center sm:p-5">
                <div className="mt-0.5 shrink-0 sm:mt-0">
                  <SourceLogo sourceId={source.id}/>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-sm font-black text-white/86">
                      {source.name}
                    </h3>
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/24">{uiMessage("ui.cf2c802a2b88")}</span>
                  </div>

                  <p className="mt-1.5 text-[12px] leading-5 text-white/45">
                    {source.role}
                  </p>

                  {source.legalNotice && (<p className="mt-2 text-[10.5px] leading-5 text-white/32">
                      {source.legalNotice}
                    </p>)}
                </div>
              </a>))}
          </div>
        </div>
      </div>
    </div>);
}

