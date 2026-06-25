export type LegalLocale = "pt-BR" | "en";

export const legalDisclaimer = {
  "pt-BR": {
    title: "Aviso de Isencao de Responsabilidade",
    body: [
      "O POPLOG e uma plataforma de curadoria, organizacao, busca e indexacao de metadados publicos e/ou licenciados sobre filmes, series, episodios, disponibilidade comercial, datas, imagens promocionais, identificadores externos e preferencias do usuario.",
      "O POPLOG nao hospeda, nao armazena, nao transmite, nao retransmite, nao distribui, nao vende, nao disponibiliza download e nao realiza streaming de obras audiovisuais protegidas por direitos autorais.",
      "As informacoes exibidas pelo POPLOG sao compostas por metadados, referencias tecnicas, dados editoriais, dados de disponibilidade e nomes ou links de servicos legais de terceiros.",
      "O usuario e responsavel por acessar obras audiovisuais somente por meios legais, autorizados e em conformidade com a legislacao aplicavel.",
      "O tratamento de dados pessoais deve observar as bases legais aplicaveis, finalidade, necessidade, transparencia, seguranca, prevencao e direitos dos titulares previstos na LGPD.",
    ],
  },
  en: {
    title: "Disclaimer",
    body: [
      "POPLOG is a curation, organization, search and metadata indexing platform for movies, TV shows, episodes, commercial availability, release dates, promotional images, external identifiers and user preferences.",
      "POPLOG does not host, store, transmit, retransmit, distribute, sell, provide downloads of, or stream copyrighted audiovisual works.",
      "Information displayed by POPLOG consists of metadata, technical references, editorial data, availability data and names or links to lawful third-party services.",
      "Users are responsible for accessing audiovisual works only through lawful and authorized means and in compliance with applicable copyright laws.",
      "Personal data processing must observe applicable legal bases, stated purpose, necessity, transparency, security, prevention and data-subject rights under the Brazilian LGPD.",
    ],
  },
} as const satisfies Record<LegalLocale, { title: string; body: readonly string[] }>;

export function getLegalDisclaimer(locale: string | null | undefined) {
  return locale?.toLowerCase().startsWith("en") ? legalDisclaimer.en : legalDisclaimer["pt-BR"];
}
