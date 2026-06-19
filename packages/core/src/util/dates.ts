/**
 * 日付ユーティリティ。期限計算・繰り返し・期限ステータスを扱う。
 * 日付は ISO 'YYYY-MM-DD' 文字列で受け渡す(ローカル日付前提、タイムゾーン非依存)。
 */

export type IsoDate = string; // 'YYYY-MM-DD'

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: IsoDate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`不正な日付形式: ${s}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // JS Date は 2026-02-30 や 2026-13-01 を黙ってロールオーバーさせるため、
  // 構築後に各要素が一致するか検証して意味的に不正な日付を弾く。
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new Error(`不正な日付: ${s}`);
  }
  return d;
}

export function addDays(s: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(s);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function addMonths(s: IsoDate, months: number): IsoDate {
  const d = parseIsoDate(s);
  const day = d.getDate();
  // 月末日(例: 1/31)に月を足すと JS Date が翌々月へロールオーバーするため、
  // 一旦 1 日に寄せてから月を進め、対象月の末日にクランプする。
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return toIsoDate(d);
}

/** 2日付の差(日数, a - b)。 */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ms = parseIsoDate(a).getTime() - parseIsoDate(b).getTime();
  return Math.round(ms / 86_400_000);
}

export type DueStatus = 'overdue' | 'due_soon' | 'upcoming' | 'none';

/**
 * 期限ステータス。today を基準に判定。
 * - overdue: 期限超過
 * - due_soon: soonDays 以内
 * - upcoming: それ以降
 * - none: due 未設定
 */
export function dueStatus(due: IsoDate | null | undefined, today: IsoDate, soonDays = 14): DueStatus {
  if (!due) return 'none';
  const d = diffDays(due, today);
  if (d < 0) return 'overdue';
  if (d <= soonDays) return 'due_soon';
  return 'upcoming';
}

export type Recurrence = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'none';

/** 次回発生日。recurrence が none の場合は null。 */
export function nextOccurrence(from: IsoDate, recurrence: Recurrence): IsoDate | null {
  switch (recurrence) {
    case 'weekly':
      return addDays(from, 7);
    case 'monthly':
      return addMonths(from, 1);
    case 'quarterly':
      return addMonths(from, 3);
    case 'yearly':
      return addMonths(from, 12);
    case 'none':
      return null;
  }
}

/** 'YYYY-MM' を返す(月次集計のキー)。 */
export function yearMonth(isoDateOrTimestamp: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDateOrTimestamp);
  if (!m) throw new Error(`日付/日時から年月を抽出できません: ${isoDateOrTimestamp}`);
  return `${m[1]}-${m[2]}`;
}
