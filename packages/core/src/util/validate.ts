/**
 * 入力バリデーション・正規化の共有ヘルパー。
 * 複数サービスで同一実装が重複していたものを集約する(単一の真実)。
 * 金額・税計算は util/money.ts、日付は util/dates.ts を参照すること。
 */

/** 空文字/空白のみ/null/undefined を null に正規化し、それ以外は trim 済み文字列を返す。 */
export function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/** 必須テキスト。空なら `${field} is required` を投げる。 */
export function requireText(value: string | null | undefined, field: string): string {
  const text = nullableText(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

/** 非空テキストか。 */
export function hasText(value: string | null | undefined): boolean {
  return nullableText(value) !== null;
}

/** 正の安全整数を要求する。 */
export function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

/** CSVセル文字列を整数にパースする。必須・整数でなければ投げる。 */
export function cellToInteger(value: string | undefined, field: string): number {
  const text = requireText(value, field);
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

/** CSVセル文字列を整数 or null にパースする(空セルは null)。 */
export function cellToNullableInteger(value: string | undefined, field: string): number | null {
  if (!value?.trim()) return null;
  return cellToInteger(value, field);
}

/** バリデーション失敗を型付きエラーコード付きで表す。message は requireText と同一に保つ（既存テスト非破壊）。 */
export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly code: string,
  ) {
    super(`${field} is required`);
    this.name = 'ValidationError';
  }
}

/** requireText のコード付き版。空なら ValidationError(field, code) を投げる。message は requireText と同一。 */
export function requireTextCoded(value: string | null | undefined, field: string, code: string): string {
  const text = nullableText(value);
  if (!text) throw new ValidationError(field, code);
  return text;
}
