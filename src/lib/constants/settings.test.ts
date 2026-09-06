import { describe, expect, it } from 'vitest';
import { applySettingValue, DEFAULT_SETTINGS, isSettingKey, mergeSettings } from './settings';

/**
 * Settings arrive from three places that can each be stale or hand-edited — a per-key
 * localStorage entry, a whole-object cache, and the server's `{key, value}` rows — so the type
 * guard is the only thing standing between a hand-edited row and a draw comparing a string
 * against a number.
 */
describe('applySettingValue', () => {
  it('adopts a value of the expected type', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'celebrationDuration', 9)).toBe(true);
    expect(target.celebrationDuration).toBe(9);
  });

  it('rejects a value whose type does not match the default', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'celebrationDuration', '9')).toBe(false);
    expect(target.celebrationDuration).toBe(DEFAULT_SETTINGS.celebrationDuration);
  });

  it('rejects a boolean written over a string setting, and the reverse', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'webhookUrl', true)).toBe(false);
    expect(applySettingValue(target, 'preventDuplicates', 'yes')).toBe(false);
    expect(target.webhookUrl).toBe('');
    expect(target.preventDuplicates).toBe(false);
  });

  it('rejects an unknown key rather than widening the object', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'notASetting', 1)).toBe(false);
    expect('notASetting' in target).toBe(false);
  });

  /** `customBackgroundImage` is the one key whose default is null, so null is legal only there. */
  it('accepts null only where the default is null', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'customBackgroundImage', null)).toBe(true);
    expect(applySettingValue(target, 'webhookUrl', null)).toBe(false);
    expect(target.webhookUrl).toBe('');
  });

  it('accepts a string for the nullable key too', () => {
    const target = { ...DEFAULT_SETTINGS };
    expect(applySettingValue(target, 'customBackgroundImage', 'data:image/png;base64,AAA')).toBe(true);
    expect(target.customBackgroundImage).toBe('data:image/png;base64,AAA');
  });
});

describe('isSettingKey', () => {
  it('recognises a real key and rejects anything else', () => {
    expect(isSettingKey('selectionMode')).toBe(true);
    expect(isSettingKey('nope')).toBe(false);
  });

  // Guards the `hasOwnProperty` call: a plain `in` check would accept these.
  it('does not accept inherited object properties as keys', () => {
    expect(isSettingKey('toString')).toBe(false);
    expect(isSettingKey('constructor')).toBe(false);
  });
});

describe('mergeSettings', () => {
  it('starts from the defaults, so a key the server has never seen still round-trips', () => {
    const merged = mergeSettings([]);
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  it('adopts good entries and ignores bad ones in the same pass', () => {
    const merged = mergeSettings([
      ['selectionMode', 'sequential'],
      ['celebrationDuration', 'not a number'],
      ['stableGrid', true],
      ['unknownKey', 'ignored']
    ]);

    expect(merged.selectionMode).toBe('sequential');
    expect(merged.stableGrid).toBe(true);
    expect(merged.celebrationDuration).toBe(DEFAULT_SETTINGS.celebrationDuration);
    expect('unknownKey' in merged).toBe(false);
  });

  it('does not mutate DEFAULT_SETTINGS', () => {
    mergeSettings([['webhookUrl', 'https://example.test/hook']]);
    expect(DEFAULT_SETTINGS.webhookUrl).toBe('');
  });

  it('lets a later entry win over an earlier one', () => {
    const merged = mergeSettings([
      ['displayDuration', 1],
      ['displayDuration', 2]
    ]);
    expect(merged.displayDuration).toBe(2);
  });
});
