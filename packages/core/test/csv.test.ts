import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from '../src/util/csv.js';

// テスト用に内部関数へアクセスする型安全でない回避策を避け、
// serializeCsv/parseCsv 経由で round-trip を検証する。
function roundTrip(value: string): string {
  const rows = parseCsv(serializeCsv([{ v: value }], { bom: false }));
  return rows[0]?.v ?? '';
}

describe('csv', () => {
  it('BOM除去 + ヘッダ付きパース', () => {
    const text = '﻿id,name\n1,太郎\n2,花子\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([
      { id: '1', name: '太郎' },
      { id: '2', name: '花子' },
    ]);
  });

  it('引用符内のカンマ・改行・エスケープ', () => {
    const text = 'a,b\n"x,y","line1\nline2"\n"he said ""hi""",z';
    const rows = parseCsv(text);
    expect(rows[0]).toEqual({ a: 'x,y', b: 'line1\nline2' });
    expect(rows[1]).toEqual({ a: 'he said "hi"', b: 'z' });
  });

  it('シリアライズ往復', () => {
    const rows = [{ a: '1', b: 'x,y' }];
    const csv = serializeCsv(rows, { bom: false });
    expect(csv).toBe('a,b\r\n1,"x,y"');
    expect(parseCsv(csv)).toEqual(rows);
  });

  describe('CSVフォーミュラインジェクション対策', () => {
    it('数式トリガ始まりのセルは出力時に先頭 \' を付与する', () => {
      const csv = serializeCsv([{ name: '=cmd', note: '@SUM' }], { bom: false });
      // 数式は ' でエスケープされ Excel 等で実行されない。
      expect(csv).toBe("name,note\r\n'=cmd,'@SUM");
    });

    it('数式エスケープは往復で元の値に戻る(自前エクスポート→インポート)', () => {
      const rows = [
        { col: '=1+1' },
        { col: '+cmd' },
        { col: '-500' }, // 負の数値も数式トリガだが往復で保持
        { col: '@foo' },
        { col: '通常テキスト' },
        { col: '商品=お得' }, // 先頭でなければガードしない
      ];
      const csv = serializeCsv(rows, { bom: false });
      // 危険なセルは ' 付きで出力される。
      expect(csv).toContain("'=1+1");
      expect(csv).toContain("'-500");
      // 中間の = はガードしない。
      expect(csv).toContain('商品=お得');
      // 往復で完全一致。
      expect(parseCsv(csv)).toEqual(rows);
    });

    it('カンマを含む数式セルはガードと引用の両方が効く', () => {
      const rows = [{ col: '=SUM(1,2)' }];
      const csv = serializeCsv(rows, { bom: false });
      expect(csv).toBe('col\r\n"\'=SUM(1,2)"');
      expect(parseCsv(csv)).toEqual(rows);
    });

    it('既存の \' を含む値も単射に往復する(データ欠落しない)', () => {
      // ユーザーが文字通り '=foo と入力した値も、二重ガードで完全復元する。
      const rows = [
        { col: "'=foo" }, // アポストロフィ+数式
        { col: "''=bar" }, // 多重アポストロフィ
        { col: "'hello" }, // アポストロフィ+非数式(ガード不要)
      ];
      const csv = serializeCsv(rows, { bom: false });
      expect(csv).toContain("''=foo"); // ' が1つ足されて二重化
      expect(parseCsv(csv)).toEqual(rows); // 完全一致で復元
    });

    it('先頭空白で数式を隠すバイパス(" =cmd")もガードする', () => {
      const rows = [{ col: ' =cmd' }, { col: '\t=cmd' }];
      const csv = serializeCsv(rows, { bom: false });
      // 先頭空白/タブを挟んだ数式にも ' を付与。
      expect(csv).toContain("' =cmd");
      // 往復で完全一致。
      expect(parseCsv(csv)).toEqual(rows);
    });
  });

  describe('unguardFormula round-trip: guard対象は可逆、未ガードデータは破壊されない', () => {
    // guard 対象: serializeCsv→parseCsv で元の値に戻る
    const guardTargets = [
      '=SUM(A1)',
      '+1',
      '-1',
      '@x',
      "'=x",   // 先頭クォート+式
      '\t=x',  // タブ+式
      '  =x',  // 空白+式
      "''=x",  // 多重クォート+式
      // TAB/CR 始まり(数式メタ文字なし): needsFormulaGuard がガードし unguard で戻る
      '\thello',
      '\rhello',
      '\t',
      '\r',
    ];
    for (const v of guardTargets) {
      it(`guard対象が可逆: ${JSON.stringify(v)}`, () => {
        expect(roundTrip(v)).toBe(v);
      });
    }

    // 未ガードデータ: serializeCsv→parseCsv で不変(データ破壊しない)
    // 注意: "'\thello"(クォート+タブ+非数式)は "'\thello" と guardFormula("\thello")="'\thello"
    // が同じ CSV 表現に衝突するため完全な可逆性を保証できない(設計上の制約)。
    // needsFormulaGuard が守る範囲(先頭が TAB/CR)の値が優先されるため、
    // 先頭クォート+TAB/CR の組み合わせはその後に数式メタ文字がなくとも剥がされる。
    // 実用上の考慮: 先頭クォート+TAB/CR はセル値としてまれなケースであり、
    // TAB/CR インジェクション対策の方が重要度が高い。
    const unguardedData = [
      "'hello",    // クォート+文字(非式・非TAB/CR) → 保護される
      'hello',     // 普通の文字列
      '',          // 空文字
      "'",         // 単独クォート
    ];
    for (const v of unguardedData) {
      it(`未ガードデータが破壊されない: ${JSON.stringify(v)}`, () => {
        expect(roundTrip(v)).toBe(v);
      });
    }
  });
});
