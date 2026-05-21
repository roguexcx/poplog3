export type FinancialBadgeTone =
  | "phenomenon"
  | "hit"
  | "surprise"
  | "return"
  | "mixed"
  | "below"
  | "flop"
  | "cold";

export type FinancialBadgeIcon =
  | "crown"
  | "rocket"
  | "flame"
  | "popcorn"
  | "dollar"
  | "scale"
  | "trendDown"
  | "snowflake";

export type FinancialBadgeInsight = {
  tone: FinancialBadgeTone;
  icon: FinancialBadgeIcon;
  label: string;
  kicker: string;
  context: string;
  budgetLabel: string;
  revenueLabel: string;
  grossMultipleLabel: string;
  breakevenLabel: string;
  breakevenRatioLabel: string;
  estimatedInvestmentLabel: string;
};

const USD = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function isPositiveMoney(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getBreakevenFactor(budget: number) {
  if (budget >= 180_000_000) return 2.5;
  if (budget >= 80_000_000) return 2.4;
  if (budget >= 25_000_000) return 2.3;
  if (budget >= 5_000_000) return 2.2;
  return 2.05;
}

function formatMoney(value: number) {
  return USD.format(value).replace(/\s/g, " ");
}

function formatMultiple(value: number) {
  if (value >= 10) return `${value.toFixed(0)}x`;
  return `${value.toFixed(1)}x`;
}

function classifyFinancialBadge(input: {
  budget: number;
  revenue: number;
  grossMultiple: number;
  breakevenRatio: number;
}): Pick<FinancialBadgeInsight, "tone" | "icon" | "label" | "kicker"> {
  const { budget, revenue, grossMultiple, breakevenRatio } = input;
  const isBlockbusterScale = budget >= 100_000_000 || revenue >= 500_000_000;
  const isSmallOrMidBudget = budget < 80_000_000;

  if (
    (revenue >= 1_000_000_000 && breakevenRatio >= 1.35) ||
    (revenue >= 500_000_000 && breakevenRatio >= 2.5) ||
    (isSmallOrMidBudget && grossMultiple >= 10 && revenue >= 150_000_000)
  ) {
    return {
      tone: "phenomenon",
      icon: "crown",
      label: "Fenômeno mundial",
      kicker: "Bilheteria em estado de evento",
    };
  }

  if (isSmallOrMidBudget && breakevenRatio >= 2.15) {
    return {
      tone: "surprise",
      icon: "rocket",
      label: "Sucesso inesperado",
      kicker: "Jogou acima da própria escala",
    };
  }

  if (isBlockbusterScale && breakevenRatio >= 1.45) {
    return {
      tone: "hit",
      icon: "flame",
      label: "Hit global",
      kicker: "Performance de grande circuito",
    };
  }

  if (revenue >= 450_000_000 && breakevenRatio >= 1.1) {
    return {
      tone: "hit",
      icon: "popcorn",
      label: "Dominou os cinemas",
      kicker: "Volume mundial forte",
    };
  }

  if (breakevenRatio >= 1.02) {
    return {
      tone: "return",
      icon: "dollar",
      label: "Deu retorno",
      kicker: "Conta fechou no azul",
    };
  }

  if (breakevenRatio >= 0.78) {
    return {
      tone: "mixed",
      icon: "scale",
      label: "Resultado misto",
      kicker: "Perto do ponto de equilíbrio",
    };
  }

  if (breakevenRatio >= 0.45) {
    return {
      tone: "below",
      icon: "trendDown",
      label: "Abaixo do esperado",
      kicker: "A bilheteria ficou curta",
    };
  }

  if (budget >= 35_000_000) {
    return {
      tone: "flop",
      icon: "trendDown",
      label: "FLOP",
      kicker: "Investimento pesado, retorno frio",
    };
  }

  return {
    tone: "cold",
    icon: "snowflake",
    label: "Frio nas bilheterias",
    kicker: "Passou sem aquecer o caixa",
  };
}

export function buildFinancialBadgeInsight(input: {
  budget?: number | null;
  revenue?: number | null;
}): FinancialBadgeInsight | null {
  if (!isPositiveMoney(input.budget) || !isPositiveMoney(input.revenue)) {
    return null;
  }

  const budget = input.budget;
  const revenue = input.revenue;
  const breakevenFactor = getBreakevenFactor(budget);
  const estimatedInvestment = budget * breakevenFactor;
  const grossMultiple = revenue / budget;
  const breakevenRatio = revenue / estimatedInvestment;
  const classification = classifyFinancialBadge({
    budget,
    revenue,
    grossMultiple,
    breakevenRatio,
  });

  const context =
    breakevenRatio >= 1
      ? `Bilheteria recuperou ~${formatMultiple(grossMultiple)} o orçamento e passou do break-even estimado.`
      : `Bilheteria fez ~${formatMultiple(grossMultiple)} o orçamento, abaixo do break-even estimado.`;

  return {
    ...classification,
    context,
    budgetLabel: formatMoney(budget),
    revenueLabel: formatMoney(revenue),
    grossMultipleLabel: formatMultiple(grossMultiple),
    breakevenLabel: `${breakevenFactor.toFixed(1)}x`,
    breakevenRatioLabel: formatMultiple(breakevenRatio),
    estimatedInvestmentLabel: formatMoney(estimatedInvestment),
  };
}
