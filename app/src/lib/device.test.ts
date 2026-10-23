import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceEnvironment } from './device';

describe('deviceEnvironment', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const android =
    'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  function stubDevice(options: {
    userAgent: string;
    platform?: string;
    touchPoints?: number;
    standaloneQuery?: boolean;
    iosStandalone?: boolean;
  }) {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(options.userAgent);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(options.platform ?? '');
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: options.touchPoints ?? 0,
      configurable: true,
    });
    window.matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: query === '(display-mode: standalone)' && options.standaloneQuery === true,
        }) as MediaQueryList,
    );
    Object.defineProperty(navigator, 'standalone', {
      value: options.iosStandalone,
      configurable: true,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (navigator as { standalone?: unknown }).standalone;
    delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
  });

  it.each([
    [
      'iPhone Safari in a tab',
      { userAgent: iphone },
      { ios: true, android: false, standalone: false },
    ],
    [
      'an iPad in desktop mode',
      { userAgent: mac, platform: 'MacIntel', touchPoints: 5 },
      { ios: true, android: false, standalone: false },
    ],
    [
      'the iPhone home-screen app',
      { userAgent: iphone, iosStandalone: true },
      { ios: true, android: false, standalone: true },
    ],
    [
      'Android Chrome in a tab',
      { userAgent: android },
      { ios: false, android: true, standalone: false },
    ],
    [
      'the installed Android app',
      { userAgent: android, standaloneQuery: true },
      { ios: false, android: true, standalone: true },
    ],
    [
      'a Mac',
      { userAgent: mac, platform: 'MacIntel' },
      { ios: false, android: false, standalone: false },
    ],
  ])('detects %s', (_name, device, expected) => {
    stubDevice(device);
    expect(deviceEnvironment()).toEqual(expected);
  });
});
