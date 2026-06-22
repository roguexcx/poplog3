/**
 * @deprecated Use `@/features/title/TitleActions` em vez disto.
 *
 * Este componente legado chamava `/api/library/update`, endpoint que nunca
 * foi reconstruido na v3. Substituido por `TitleActions`, que faz POST
 * em `/api/library/title` (endpoint canonico) e ainda dispara o auto-sync
 * de episodios para series.
 */
export {};
