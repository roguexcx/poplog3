"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { ListsApiSuccess, UserListRecord } from "@/types/lists";
type CreateListModalProps = {
    open: boolean;
    list?: UserListRecord | null;
    onClose: () => void;
    onSaved: (list: UserListRecord) => void | Promise<void>;
};
export default function CreateListModal({ open, list = null, onClose, onSaved, }: CreateListModalProps) {
    const [mounted, setMounted] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    const isEditing = Boolean(list);
    useEffect(() => setMounted(true), []);
    useEffect(() => {
        if (!open)
            return;
        setName(list?.name ?? "");
        setDescription(list?.description ?? "");
        setError(null);
        const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape")
                onClose();
        }
        document.addEventListener("keydown", handleEscape);
        document.body.style.overflow = "hidden";
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener("keydown", handleEscape);
            document.body.style.overflow = "";
        };
    }, [list, onClose, open]);
    if (!mounted || !open)
        return null;
    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError(uiMessage("ui.7d3cafa368ed"));
            inputRef.current?.focus();
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(isEditing ? `/api/lists/${list?.id}` : "/api/lists", {
                method: isEditing ? "PATCH" : "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    name: trimmedName,
                    description: description.trim() || null,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(typeof payload.error === "string" ? payload.error : uiMessage("ui.b40823655a69"));
            }
            const saved = (payload as ListsApiSuccess<UserListRecord>).data;
            await onSaved(saved);
            onClose();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : uiMessage("ui.b40823655a69"));
        }
        finally {
            setSaving(false);
        }
    }
    return createPortal(<div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onMouseDown={() => !saving && onClose()}>
      <form onSubmit={handleSubmit} onMouseDown={(event) => event.stopPropagation()} className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/[0.11] bg-[#09090f] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.72)] sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(99,102,241,0.16),transparent_50%)]"/>
        <div className="relative">
          <button type="button" onClick={onClose} disabled={saving} className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40" aria-label="Fechar">
            <X className="h-4 w-4"/>
          </button>

          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-200/60">{uiMessage("ui.673546971a88")}</p>
          <h2 id={titleId} className="mt-2 pr-12 text-2xl font-black tracking-[-0.04em] text-white">
            {isEditing ? "Editar lista" : "Criar nova lista"}
          </h2>
          <p id={descriptionId} className="mt-2 max-w-md text-sm leading-6 text-white/45">{uiMessage("ui.dbd833e760c5")}</p>

          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-white/66">Nome</span>
              <input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="off" className="h-12 w-full rounded-2xl border border-white/[0.11] bg-white/[0.045] px-4 text-sm font-semibold text-white outline-none transition placeholder:text-white/24 focus:border-indigo-300/45 focus:bg-white/[0.065] focus:ring-2 focus:ring-indigo-400/15" placeholder={uiMessage("ui.98246c2b87e8")}/>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold text-white/66">{uiMessage("ui.7bb65bb52948")}</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} className="w-full resize-none rounded-2xl border border-white/[0.11] bg-white/[0.045] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/24 focus:border-indigo-300/45 focus:bg-white/[0.065] focus:ring-2 focus:ring-indigo-400/15" placeholder={uiMessage("ui.0fad93484d6a")}/>
            </label>
          </div>

          {error && (<p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/[0.10] px-4 py-3 text-sm font-semibold text-rose-100">
              {error}
            </p>)}

          <div className="mt-6 flex justify-end gap-2.5">
            <button type="button" onClick={onClose} disabled={saving} className="h-11 rounded-full px-5 text-sm font-bold text-white/55 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 bg-white px-6 text-sm font-black text-zinc-950 shadow-[0_14px_34px_rgba(255,255,255,0.16)] transition hover:-translate-y-0.5 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60">
              {saving ? "Salvando…" : isEditing ? uiMessage("ui.3bbd538880d0") : "Criar lista"}
            </button>
          </div>
        </div>
      </form>
    </div>, document.body);
}

