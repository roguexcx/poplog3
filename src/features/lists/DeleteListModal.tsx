"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
type DeleteListModalProps = {
    open: boolean;
    listName: string;
    deleting: boolean;
    error?: string | null;
    onClose: () => void;
    onConfirm: () => void;
};
export default function DeleteListModal({ open, listName, deleting, error = null, onClose, onConfirm, }: DeleteListModalProps) {
    const titleId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open)
            return;
        const timer = window.setTimeout(() => cancelRef.current?.focus(), 30);
        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape" && !deleting)
                onClose();
        }
        document.addEventListener("keydown", handleEscape);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [deleting, onClose, open]);
    if (!open)
        return null;
    return createPortal(<div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/74 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={() => !deleting && onClose()}>
      <div className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-rose-300/[0.16] bg-[#0b090d] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.72)]" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} disabled={deleting} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40" aria-label="Fechar">
          <X className="h-4 w-4"/>
        </button>
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-rose-300/20 bg-rose-500/[0.12] text-rose-200">
          <Trash2 className="h-5 w-5"/>
        </span>
        <h2 id={titleId} className="mt-5 pr-10 text-xl font-black tracking-[-0.035em] text-white">{uiMessage("ui.4d81d66fa4b9")}{listName}”?</h2>
        <p className="mt-3 text-sm leading-6 text-white/45">{uiMessage("ui.31a21a98a493")}</p>
        {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/[0.10] px-4 py-3 text-xs font-semibold text-rose-100">{error}</p>}
        <div className="mt-6 flex justify-end gap-2.5">
          <button ref={cancelRef} type="button" onClick={onClose} disabled={deleting} className="h-10 rounded-full px-4 text-xs font-bold text-white/55 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={deleting} className="inline-flex h-10 items-center rounded-full border border-rose-200/25 bg-rose-500/[0.18] px-5 text-xs font-black text-rose-50 transition hover:bg-rose-500/[0.28] disabled:cursor-wait disabled:opacity-50">
            {deleting ? "Excluindo…" : "Excluir lista"}
          </button>
        </div>
      </div>
    </div>, document.body);
}

