import { describe, expect, it } from 'vitest';
import { extractMentions } from './MentionInput';

describe('extractMentions', () => {
  it('finds unique user ids in mention tokens', () => {
    const a = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
    const b = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
    const text = `Hi @[Ana Lee](user:${a}) and @[Bo](user:${b}), cc @[Ana Lee](user:${a}). Not a mention: @someone`;
    expect(extractMentions(text)).toEqual([a, b]);
  });
  it('ignores malformed tokens', () => {
    expect(extractMentions('@[x](user:not-a-uuid) @[y](https://example.com)')).toEqual([]);
  });
});
