import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, dueStatus, nextOccurrence } from '../src/util/dates.js';

describe('dates utility', () => {
  describe('addMonths', () => {
    it('通常の月加算', () => {
      expect(addMonths('2026-06-19', 1)).toBe('2026-07-19');
      expect(addMonths('2026-06-19', 3)).toBe('2026-09-19');
      expect(addMonths('2026-06-19', -1)).toBe('2026-05-19');
    });

    it('月末日(31日)から短い月へ進めても翌々月へロールオーバーしない(末日にクランプ)', () => {
      // 1/31 + 1ヶ月 は 2/28(うるう年でなければ)になるべき。2026年は平年。
      expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
      // 3/31 + 1ヶ月 は 4/30。
      expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
      // 5/31 + 1ヶ月 は 6/30。
      expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
    });

    it('うるう年の2月末を正しく扱う', () => {
      // 2024はうるう年。2024-01-31 + 1ヶ月 = 2024-02-29。
      expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
      // 1/31 + 12ヶ月 は翌年の1/31(末日変化なし)。
      expect(addMonths('2026-01-31', 12)).toBe('2027-01-31');
    });

    it('年跨ぎの月加算', () => {
      expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
      expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    });
  });

  describe('nextOccurrence', () => {
    it('各周期で次回発生日を返す', () => {
      expect(nextOccurrence('2026-06-19', 'weekly')).toBe('2026-06-26');
      expect(nextOccurrence('2026-06-19', 'monthly')).toBe('2026-07-19');
      expect(nextOccurrence('2026-06-19', 'quarterly')).toBe('2026-09-19');
      expect(nextOccurrence('2026-06-19', 'yearly')).toBe('2027-06-19');
      expect(nextOccurrence('2026-06-19', 'none')).toBeNull();
    });

    it('月末の月次繰り返しでも末日クランプされる', () => {
      expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    });
  });

  describe('diffDays / dueStatus', () => {
    it('日数差を返す', () => {
      expect(diffDays('2026-06-20', '2026-06-19')).toBe(1);
      expect(diffDays('2026-06-19', '2026-06-20')).toBe(-1);
      expect(diffDays('2026-07-19', '2026-06-19')).toBe(30);
    });

    it('期限ステータスを境界含めて判定する', () => {
      const today = '2026-06-19';
      expect(dueStatus(null, today)).toBe('none');
      expect(dueStatus('2026-06-18', today)).toBe('overdue');
      expect(dueStatus('2026-06-19', today)).toBe('due_soon'); // 当日
      expect(dueStatus('2026-07-03', today)).toBe('due_soon'); // ちょうど14日後
      expect(dueStatus('2026-07-04', today)).toBe('upcoming'); // 15日後
    });
  });

  it('addDays は日付を加減算する', () => {
    expect(addDays('2026-06-19', 7)).toBe('2026-06-26');
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });
});
