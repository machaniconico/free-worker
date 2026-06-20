import { describe, it, expect } from 'vitest';
import {
  taxFromInclusive,
  exclusiveFromInclusive,
  inclusiveFromExclusive,
  sumTaxIncluded,
  formatYen,
  computeWithholdingTax,
  TAX_RATE_REDUCED,
} from '../src/util/money.js';

describe('money', () => {
  it('税込から消費税額(10%, 切り捨て)', () => {
    // 1100税込 -> 税100
    expect(taxFromInclusive(1100)).toBe(100);
    // 1280税込 -> 税 116.36... -> floor 116
    expect(taxFromInclusive(1280)).toBe(116);
  });

  it('軽減税率8%', () => {
    expect(taxFromInclusive(1080, TAX_RATE_REDUCED)).toBe(80);
  });

  it('税込から税抜', () => {
    expect(exclusiveFromInclusive(1100)).toBe(1000);
    expect(exclusiveFromInclusive(1280)).toBe(1164);
  });

  it('税抜から税込(往復)', () => {
    expect(inclusiveFromExclusive(1000)).toBe(1100);
  });

  it('明細合計', () => {
    expect(
      sumTaxIncluded([
        { unitPriceTaxIncluded: 1100, quantity: 2 },
        { unitPriceTaxIncluded: 500, quantity: 3 },
      ]),
    ).toBe(3700);
  });

  it('非整数金額は拒否', () => {
    expect(() => taxFromInclusive(100.5)).toThrow();
  });

  it('2^53超の大整数(精度喪失)は拒否', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1; // 9007199254740992
    expect(() => taxFromInclusive(unsafe)).toThrow();
    expect(() => inclusiveFromExclusive(unsafe)).toThrow();
  });

  it('円表記', () => {
    expect(formatYen(1280)).toBe('¥1,280');
    expect(formatYen(-500)).toBe('-¥500');
  });
});

describe('computeWithholdingTax', () => {
  it('0円 → 0', () => {
    expect(computeWithholdingTax(0)).toBe(0);
  });

  it('10,000円 → 1,021円 (10.21% 切り捨て)', () => {
    expect(computeWithholdingTax(10_000)).toBe(1_021);
  });

  it('100,000円 → 10,210円', () => {
    expect(computeWithholdingTax(100_000)).toBe(10_210);
  });

  it('1,000,000円 → 102,100円 (境界)', () => {
    expect(computeWithholdingTax(1_000_000)).toBe(102_100);
  });

  it('1,500,000円 → 204,200円 (超過分 20.42%)', () => {
    // 超過分: (1,500,000 - 1,000,000) * 0.2042 = 102,100 → floor = 102,100
    // 合計: 102,100 + 102,100 = 204,200
    expect(computeWithholdingTax(1_500_000)).toBe(204_200);
  });

  it('負値は拒否', () => {
    expect(() => computeWithholdingTax(-1)).toThrow();
  });

  it('非整数は拒否', () => {
    expect(() => computeWithholdingTax(100.5)).toThrow();
  });
});
