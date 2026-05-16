import { translate } from "google-translate-api-x";

export type TranslationResult = {
  originalText: string;
  translatedText: string;
  translated: boolean;
  sourceLanguage: string | null;
  error?: string;
};

function cleanText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikePortuguese(text: string) {
  const normalized = text.toLowerCase();

  const portugueseSignals = [
    " você ",
    " vocês ",
    " também ",
    " então ",
    " muito ",
    " episódio ",
    " filme ",
    " série ",
    " achei ",
    " gostei ",
    " porque ",
    " cara ",
    " demais ",
    " realmente ",
    " incrível ",
  ];

  return portugueseSignals.some((signal) =>
    ` ${normalized} `.includes(signal)
  );
}

export async function translateToPtBr(
  input: string
): Promise<TranslationResult> {
  const originalText = cleanText(input || "");

  if (!originalText) {
    return {
      originalText: "",
      translatedText: "",
      translated: false,
      sourceLanguage: null,
    };
  }

  if (looksLikePortuguese(originalText)) {
    return {
      originalText,
      translatedText: originalText,
      translated: false,
      sourceLanguage: "pt",
    };
  }

  try {
    const result = await translate(originalText, {
      to: "pt",
      forceBatch: false,
    });

    const translatedText = cleanText(result.text || originalText);

    return {
      originalText,
      translatedText,
      translated:
        translatedText.toLowerCase() !== originalText.toLowerCase(),
      sourceLanguage: result.from?.language?.iso || null,
    };
  } catch (error: any) {
    return {
      originalText,
      translatedText: originalText,
      translated: false,
      sourceLanguage: null,
      error: error?.message || "translation_failed",
    };
  }
}