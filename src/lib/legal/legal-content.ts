import type { LegalLocale } from "@/lib/legal/disclaimer";

export const LEGAL_TERMS_VERSION = "2026-06-25";
export const LEGAL_PRIVACY_VERSION = "2026-06-25";

export type LegalSection = {
  heading: string;
  paragraphs: string[];
};

export type LegalDocument = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  updatedLabel: string;
  intro: string;
  referencesLabel: string;
  sections: LegalSection[];
  references: string[];
};

const ptBR: LegalDocument = {
  title: "Termos, Disclaimer e Privacidade",
  metaTitle: "Termos, Disclaimer e Privacidade",
  metaDescription:
    "Aviso legal, isencao de responsabilidade, protecao de dados (LGPD) e canal de remocao/correcao de metadados do POPLOG.",
  updatedLabel: "Atualizado em",
  intro:
    "Este documento e um aviso operacional de conformidade do POPLOG. Nao substitui aconselhamento juridico e deve ser revisado por profissional habilitado antes da publicacao em producao.",
  referencesLabel: "Referencias legais",
  sections: [
    {
      heading: "Aviso de Isencao de Responsabilidade",
      paragraphs: [
        "O POPLOG e uma plataforma de curadoria, organizacao, busca e indexacao de metadados publicos e/ou licenciados sobre filmes, series, episodios, disponibilidade comercial, datas, imagens promocionais, identificadores externos e preferencias do usuario.",
        "O POPLOG nao hospeda, nao armazena, nao transmite, nao retransmite, nao distribui, nao vende, nao disponibiliza download e nao realiza streaming de obras audiovisuais protegidas por direitos autorais. O sistema nao fornece links para copias piratas, nao contorna medidas tecnologicas de protecao e nao autoriza qualquer uso irregular de conteudo de terceiros.",
        "As informacoes exibidas pelo POPLOG sao compostas por metadados, referencias tecnicas, dados editoriais, dados de disponibilidade e links ou nomes de servicos legais de terceiros. Quando houver indicacao de provedores, lojas, canais, plataformas ou servicos de streaming, essa indicacao tem finalidade meramente informativa e pode depender de regiao, idioma, disponibilidade contratual, catalogo, login, assinatura, aluguel, compra, canal adicional ou outras condicoes definidas exclusivamente pelos respectivos provedores.",
        "Todos os titulos, marcas, nomes, logos, posters, imagens promocionais, descricoes, trailers e demais sinais distintivos pertencem aos seus respectivos titulares. A exibicao de metadados e referencias nao implica afiliacao, endosso, patrocinio ou autorizacao comercial pelos titulares, salvo quando houver acordo expresso.",
        "O usuario e responsavel por acessar obras audiovisuais somente por meios legais, autorizados e em conformidade com a legislacao aplicavel, incluindo a legislacao brasileira de direitos autorais. O POPLOG nao se responsabiliza por conteudos, disponibilidade, politicas, precos, erros, indisponibilidades, mudancas de catalogo ou decisoes comerciais de plataformas externas.",
      ],
    },
    {
      heading: "Protecao de Dados e LGPD",
      paragraphs: [
        "O POPLOG trata dados pessoais de forma limitada e proporcional as funcionalidades oferecidas, como autenticacao, preferencias de idioma/regiao, biblioteca, listas, progresso, avaliacoes, historico operacional e configuracoes de experiencia.",
        "O tratamento de dados pessoais deve observar as bases legais aplicaveis, a finalidade informada, a necessidade, a transparencia, a seguranca, a prevencao e os direitos dos titulares previstos na Lei Geral de Protecao de Dados Pessoais (LGPD).",
        "Cookies essenciais e armazenamento local podem ser usados para manter sessao, seguranca, idioma, regiao, consentimentos e funcionamento basico do produto. Cookies nao essenciais, publicidade personalizada, analytics ou tecnologias equivalentes dependem de configuracao especifica, informacao clara ao usuario e consentimento quando exigido.",
        "O usuario pode solicitar informacoes sobre seus dados, correcao, exclusao, portabilidade ou revogacao de consentimento pelos canais de contato definidos na Politica de Privacidade do POPLOG.",
      ],
    },
    {
      heading: "Remocao ou Correcao de Metadados",
      paragraphs: [
        "Titulares de direitos, representantes autorizados ou usuarios que identifiquem metadados incorretos, imagem indevida, violacao de marca, informacao sensivel ou referencia inadequada podem solicitar revisao, correcao, remocao ou atualizacao por meio do canal oficial de contato do POPLOG.",
        "O POPLOG podera remover, ocultar, corrigir ou atualizar informacoes quando identificar erro, risco juridico, violacao de politica interna, solicitacao valida de titular de direitos ou exigencia legal.",
      ],
    },
  ],
  references: [
    "Lei Geral de Protecao de Dados Pessoais (LGPD), Lei no 13.709/2018.",
    "Lei de Direitos Autorais, Lei no 9.610/1998.",
  ],
};

const en: LegalDocument = {
  title: "Terms, Disclaimer and Privacy",
  metaTitle: "Terms, Disclaimer and Privacy",
  metaDescription:
    "Legal notice, disclaimer, data protection (LGPD) and the metadata removal/correction channel for POPLOG.",
  updatedLabel: "Last updated",
  intro:
    "This document is an operational compliance notice for POPLOG. It is not a substitute for legal advice and should be reviewed by qualified counsel before publication in production.",
  referencesLabel: "Legal References",
  sections: [
    {
      heading: "Disclaimer",
      paragraphs: [
        "POPLOG is a curation, organization, search and metadata indexing platform for movies, TV shows, episodes, commercial availability, release dates, promotional images, external identifiers and user preferences.",
        "POPLOG does not host, store, transmit, retransmit, distribute, sell, provide downloads of, or stream copyrighted audiovisual works. The system does not provide links to pirated copies, does not circumvent technological protection measures and does not authorize any unlawful use of third-party content.",
        "Information displayed by POPLOG consists of metadata, technical references, editorial data, availability data and names or links to lawful third-party services. Provider, store, channel, platform or streaming-service information is provided for informational purposes only and may vary by region, language, catalog, login, subscription, rental, purchase, add-on channel or other conditions controlled exclusively by the respective providers.",
        "All titles, trademarks, names, logos, posters, promotional images, descriptions, trailers and other distinctive signs belong to their respective owners. Displaying metadata and references does not imply affiliation, endorsement, sponsorship or commercial authorization by rights holders, unless expressly agreed.",
        "Users are responsible for accessing audiovisual works only through lawful and authorized means and in compliance with applicable copyright laws. POPLOG is not responsible for third-party content, availability, policies, prices, errors, outages, catalog changes or commercial decisions made by external platforms.",
      ],
    },
    {
      heading: "Data Protection and LGPD",
      paragraphs: [
        "POPLOG processes personal data in a limited and proportionate way for the features it provides, such as authentication, language/region preferences, library, lists, progress, ratings, operational history and experience settings.",
        "Personal data processing must observe applicable legal bases, stated purpose, necessity, transparency, security, prevention and data-subject rights under the Brazilian General Data Protection Law (LGPD).",
        "Essential cookies and local storage may be used to maintain session, security, language, region, consent records and basic product functionality. Non-essential cookies, personalized advertising, analytics or equivalent technologies depend on specific configuration, clear information to users and consent when required.",
        "Users may request information about their data, correction, deletion, portability or withdrawal of consent through the contact channels defined in POPLOG's Privacy Policy.",
      ],
    },
    {
      heading: "Metadata Removal or Correction",
      paragraphs: [
        "Rights holders, authorized representatives or users who identify incorrect metadata, improper images, trademark concerns, sensitive information or inappropriate references may request review, correction, removal or update through POPLOG's official contact channel.",
        "POPLOG may remove, hide, correct or update information when it identifies an error, legal risk, internal-policy violation, valid rights-holder request or legal requirement.",
      ],
    },
  ],
  references: [
    "Brazilian General Data Protection Law (LGPD), Law No. 13,709/2018.",
    "Brazilian Copyright Law, Law No. 9,610/1998.",
  ],
};

const documents = { "pt-BR": ptBR, en } satisfies Record<LegalLocale, LegalDocument>;

export function getLegalDocument(locale: string | null | undefined): LegalDocument {
  return locale?.toLowerCase().startsWith("en") ? documents.en : documents["pt-BR"];
}
