export type DeviceEnvironment = {
  ios: boolean;
  android: boolean;
  standalone: boolean;
};

export function deviceEnvironment(): DeviceEnvironment {
  return {
    ios:
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/.test(navigator.userAgent),
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}
