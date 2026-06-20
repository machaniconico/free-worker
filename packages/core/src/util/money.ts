/**
 * 金額ユーティリティ。金額は整数(円・最小通貨単位)で扱う。
 * 日本の消費税(標準10% / 軽減8%)を前提に、税込/税抜/税額を相互変換する。
 * 丸めはここに集約する(UI/サーバで独自に丸めない)。
 */

export const TAX_RATE_STANDARD = 0.1;
export const TAX_RATE_REDUCED = 0.08;

export type RoundMode = 'floor' | 'round' | 'ceil';

function applyRound(value: number, mode: RoundMode): number {
  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'round':
      // 0.5 は四捨五入(銀行丸めではなく一般的な切り上げ)
      return Math.round(value);
  }
}

/** 税込金額に含まれる消費税額を求める。既定は円未満切り捨て。 */
export function taxFromInclusive(
  inclusive: number,
  rate: number = TAX_RATE_STANDARD,
  mode: RoundMode = 'floor',
): number {
  assertIntYen(inclusive);
  const tax = inclusive - inclusive / (1 + rate);
  return applyRound(tax, mode);
}

/** 税込金額から税抜金額を求める。 */
export function exclusiveFromInclusive(
  inclusive: number,
  rate: number = TAX_RATE_STANDARD,
  mode: RoundMode = 'floor',
): number {
  return inclusive - taxFromInclusive(inclusive, rate, mode);
}

/** 税抜金額から税込金額を求める。 */
export function inclusiveFromExclusive(
  exclusive: number,
  rate: number = TAX_RATE_STANDARD,
  mode: RoundMode = 'floor',
): number {
  assertIntYen(exclusive);
  return exclusive + applyRound(exclusive * rate, mode);
}

/** 税込合計(複数明細)。各 unit_price_tax_included * qty の単純合計。 */
export function sumTaxIncluded(items: ReadonlyArray<{ unitPriceTaxIncluded: number; quantity: number }>): number {
  return items.reduce((acc, it) => {
    assertIntYen(it.unitPriceTaxIncluded);
    return acc + it.unitPriceTaxIncluded * it.quantity;
  }, 0);
}

/** 円表記(総額表示用)。例: 1280 -> "¥1,280" */
export function formatYen(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amount));
  return `${sign}¥${abs.toLocaleString('ja-JP')}`;
}

function assertIntYen(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`金額は整数(円)で扱ってください: ${n}`);
  }
}
