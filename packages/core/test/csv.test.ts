import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from '../src/util/csv.js';

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
});
