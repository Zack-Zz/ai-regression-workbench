import { describe, expect, it } from 'vitest';
import { parseVerificationChallengeResponse } from '../src/playwright-tool-provider.js';

describe('parseVerificationChallengeResponse', () => {
  it('parses a valid verification payload', () => {
    const parsed = parseVerificationChallengeResponse(JSON.stringify({
      result: {
        backImage: 'data:image/png;base64,AAAA',
        slidingImage: 'data:image/png;base64,BBBB',
        originalWidth: 320,
        originalHeight: 160,
        sliderWidth: 52,
        sliderHeight: 52,
        randomY: 37,
        effectiveTime: 420,
        key: 'abc',
      },
    }));
    expect(parsed).toEqual({
      backImage: 'data:image/png;base64,AAAA',
      slidingImage: 'data:image/png;base64,BBBB',
      originalWidth: 320,
      originalHeight: 160,
      sliderWidth: 52,
      sliderHeight: 52,
      randomY: 37,
      effectiveTime: 420,
      key: 'abc',
    });
  });

  it('normalizes invalid numeric fields and clamps effectiveTime minimum', () => {
    const parsed = parseVerificationChallengeResponse(JSON.stringify({
      result: {
        backImage: 'x',
        slidingImage: 'y',
        originalWidth: 320,
        originalHeight: 160,
        sliderWidth: 52,
        sliderHeight: 52,
        randomY: -7,
        effectiveTime: 0,
      },
    }));
    expect(parsed).toMatchObject({
      randomY: 0,
      effectiveTime: 300,
    });
  });

  it('returns undefined for invalid payload', () => {
    expect(parseVerificationChallengeResponse('not json')).toBeUndefined();
    expect(parseVerificationChallengeResponse(JSON.stringify({ result: {} }))).toBeUndefined();
  });
});
