import { describe, expect, it } from 'vitest';
import { supportedEnvironment } from '../test/fakePush';
import { pushSupport } from './support';

describe('pushSupport', () => {
  it.each([
    ['a desktop or Android browser with everything', {}, 'supported'],
    ['iOS Safari in a tab', { ios: true, standalone: false, pushManager: false }, 'needs-install'],
    ['iOS installed on the home screen', { ios: true, standalone: true }, 'supported'],
    [
      'an installed iOS app on a version without push',
      { ios: true, standalone: true, pushManager: false },
      'unsupported',
    ],
    ['no service worker', { serviceWorker: false }, 'unsupported'],
    ['no Notification API', { notification: false }, 'unsupported'],
    ['a build without the VAPID key', { vapidKey: undefined }, 'no-key'],
  ] as const)('%s → %s', (_name, overrides, expected) => {
    expect(pushSupport({ ...supportedEnvironment, ...overrides })).toBe(expected);
  });
});
