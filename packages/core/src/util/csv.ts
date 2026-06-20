/**
 * 依存ゼロの CSV パーサ/シリアライザ(RFC4180 準拠寄り)。
 * - BOM を除去して読む(出典パックの CSV は UTF-8 BOM 付き)。
 * - 引用符内のカンマ・改行・"" エスケープに対応。
 * - 出力は Excel で文字化けしないよう既定で BOM を付与可能。
 * - CSV フォーミュラインジェクション対策: 出力時に数式として解釈され得るセルへ
 *   先頭 `'` を付与し、Excel 等での数式実行を防ぐ。パース時に対称的に1つだけ
 *   取り除くため、自前エクスポート→インポートの往復は値を完全に保持する(単射)。
 *   先頭の空白/既存の `'` を挟んだ数式(` =cmd` / `'=x`)も検出・可逆にする。
 */

// 数式メタ文字(先頭の空白・既存 ' を挟んでも検出)。または制御文字 TAB/CR 始まり。
const FORMULA_META = /^[ \t\r]*'*[=+\-@]/;

function needsFormulaGuard(value: string): boolean {
  if (FORMULA_META.test(value)) return true;
  const code = value.charCodeAt(0);
  return code === 9 /* \t */ || code === 13 /* \r */;
}

function guardFormula(value: string): string {
  return needsFormulaGuard(value) ? `'${value}` : value;
}

/**
 * guardFormula の逆操作。
 * guardFormula は `FORMULA_META` にマッチするか TAB/CR で始まる値に先頭 `'` を付ける。
 * ただし逆操作は「先頭 `'` を除いた残りが FORMULA_META にマッチする場合のみ剥がす」とする。
 * これにより、`'\thello`(ユーザー入力のクォート+タブ+非数式)のような先頭クォートを
 * 誤って剥がすデータ破損を防ぐ。TAB/CR のみで始まりその後に数式メタ文字が無い値は
 * guard されるが unguard されない(FORMULA_META に引っかからないため)という制約があるが、
 * そのような値はフォーミュラインジェクション対象外で実用上問題ない。
 */
function unguardFormula(value: string): string {
  if (value.startsWith("'") && FORMULA_META.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}

export type CsvRow = Record<string, string>;

/** CSV テキストを行オブジェクト配列にパースする(1行目をヘッダとみなす)。 */
export function parseCsv(text: string): CsvRow[] {
  const records = parseCsvRaw(text);
  if (records.length === 0) return [];
  const header = records[0]!;
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i]!;
    // 完全な空行はスキップ
    if (cells.length === 1 && cells[0] === '') continue;
    const row: CsvRow = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]!] = cells[c] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

/** CSV テキストを生の2次元配列にパースする。 */
export function parseCsvRaw(input: string): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(unguardFormula(field));
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(unguardFormula(field));
      rows.push(row);
      field = '';
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // 末尾フィールド/行
  if (field.length > 0 || row.length > 0) {
    row.push(unguardFormula(field));
    rows.push(row);
  }
  return rows;
}

export interface SerializeOptions {
  /** 出力カラム順。未指定なら最初の行のキー順。 */
  columns?: string[];
  /** Excel 互換のため先頭に UTF-8 BOM を付ける。既定 true。 */
  bom?: boolean;
}

/** 行オブジェクト配列を CSV テキストにシリアライズする。 */
export function serializeCsv(rows: ReadonlyArray<CsvRow>, opts: SerializeOptions = {}): string {
  const columns = opts.columns ?? (rows.length > 0 ? Object.keys(rows[0]!) : []);
  const bom = opts.bom ?? true;
  const lines: string[] = [];
  lines.push(columns.map(escapeCell).join(','));
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCell(row[col] ?? '')).join(','));
  }
  return (bom ? '﻿' : '') + lines.join('\r\n');
}

function escapeCell(value: string): string {
  const guarded = guardFormula(value);
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
