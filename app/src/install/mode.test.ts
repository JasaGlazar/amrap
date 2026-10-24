import { describe, expect, it } from 'vitest';
import { installMode, type InstallModeInput } from './mode';

const browserTab: InstallModeInput = {
  standalone: false,
  ios: false,
  android: false,
  installed: false,
  hasPrompt: false,
};

describe('installMode', () => {
  it.each<[string, Partial<InstallModeInput>, ReturnType<typeof installMode>]>([
    ['the installed app', { standalone: true, hasPrompt: true }, 'hidden'],
    ['the installed app on iOS', { standalone: true, ios: true }, 'hidden'],
    ['a tab right after installing', { installed: true, android: true }, 'hidden'],
    ['Chrome with an install prompt', { hasPrompt: true }, 'prompt'],
    ['Android Chrome with an install prompt', { hasPrompt: true, android: true }, 'prompt'],
    ['iOS Safari in a tab', { ios: true }, 'ios'],
    ['an Android browser without a prompt', { android: true }, 'android-manual'],
    ['a desktop browser without a prompt', {}, 'none'],
  ])('is right for %s', (_name, input, expected) => {
    expect(installMode({ ...browserTab, ...input })).toBe(expected);
  });
});
