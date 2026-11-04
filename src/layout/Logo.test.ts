import { describe, expect, it } from 'vitest';
import favicon from '../../public/favicon.svg?raw';
import { LOGO_SQUARES, LOGO_TILE } from './Logo';

describe('logo', () => {
  it('uses the same colours as the browser tab icon', () => {
    const svg = favicon.toUpperCase();
    expect(svg).toContain(`FILL="${LOGO_TILE}"`);
    for (const c of LOGO_SQUARES) expect(svg).toContain(`FILL="${c}"`);
    expect((svg.match(/<RECT/g) ?? []).length).toBe(1 + LOGO_SQUARES.length);
  });
});
