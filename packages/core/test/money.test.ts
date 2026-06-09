import { describe, it, expect } from 'vitest';
import {
  taxFromInclusive,
  exclusiveFromInclusive,
  inclusiveFromExclusive,
  sumTaxIncluded,
  formatYen,
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

  it('円表記', () => {
    expect(formatYen(1280)).toBe('¥1,280');
    expect(formatYen(-500)).toBe('-¥500');
  });
});
