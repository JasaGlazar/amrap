import { createContext } from 'react';
import { deviceEnvironment, type DeviceEnvironment } from '../lib/device';
import { createInstallStore, type InstallStore } from './capture';

export type InstallPlatform = {
  device(): DeviceEnvironment;
  store: InstallStore;
};

export const installPlatform: InstallPlatform = {
  device: deviceEnvironment,
  store: createInstallStore(() => window.localStorage),
};

export const InstallContext = createContext<InstallPlatform>(installPlatform);
