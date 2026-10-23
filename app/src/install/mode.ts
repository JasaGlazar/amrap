export type InstallMode = 'hidden' | 'prompt' | 'ios' | 'android-manual' | 'none';

export type InstallModeInput = {
  standalone: boolean;
  ios: boolean;
  android: boolean;
  installed: boolean;
  hasPrompt: boolean;
};

export function installMode(input: InstallModeInput): InstallMode {
  if (input.standalone || input.installed) return 'hidden';
  if (input.hasPrompt) return 'prompt';
  if (input.ios) return 'ios';
  if (input.android) return 'android-manual';
  return 'none';
}
