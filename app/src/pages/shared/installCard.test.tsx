import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { createInstallStore } from '../../install/capture';
import { InstallContext, type InstallPlatform } from '../../install/platform';
import { fakeInstallPlatform } from '../../test/fakeInstall';
import { InstallCard } from './InstallCard';

function renderWith(platform: InstallPlatform, children: ReactNode = <InstallCard />) {
  return render(<InstallContext.Provider value={platform}>{children}</InstallContext.Provider>);
}

const card = () => screen.queryByRole('region', { name: t.install.title });

describe('InstallCard', () => {
  it('offers the browser install prompt and hides once it is accepted', async () => {
    const { platform, firePrompt } = fakeInstallPlatform();
    const event = firePrompt('accepted');
    renderWith(platform);

    await userEvent.click(screen.getByRole('button', { name: t.install.install }));

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(card()).not.toBeInTheDocument();
  });

  it('shows the button when the prompt arrives after the first render', () => {
    const { platform, firePrompt } = fakeInstallPlatform({ device: { android: true } });
    renderWith(platform);
    expect(screen.queryByRole('button', { name: t.install.install })).not.toBeInTheDocument();

    act(() => void firePrompt());

    expect(screen.getByRole('button', { name: t.install.install })).toBeInTheDocument();
  });

  it('falls back to the menu steps on Android when the prompt was declined', async () => {
    const { platform, firePrompt } = fakeInstallPlatform({ device: { android: true } });
    firePrompt('dismissed');
    renderWith(platform);

    await userEvent.click(screen.getByRole('button', { name: t.install.install }));

    expect(await screen.findByText(t.install.androidMenu)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.install.install })).not.toBeInTheDocument();
  });

  it('gives the Share steps on iOS', () => {
    const { platform } = fakeInstallPlatform({ device: { ios: true } });
    renderWith(platform);
    const steps = screen.getByRole('list', { name: t.install.stepsLabel });
    expect(steps).toHaveTextContent(t.install.iosShare);
    expect(steps).toHaveTextContent(t.install.iosAdd);
    expect(steps).toHaveTextContent(t.install.openFromHome);
    expect(screen.getByText(t.install.iosWhy)).toBeInTheDocument();
  });

  it('gives the browser menu steps on Android without a prompt', () => {
    const { platform } = fakeInstallPlatform({ device: { android: true } });
    renderWith(platform);
    const steps = screen.getByRole('list', { name: t.install.stepsLabel });
    expect(steps).toHaveTextContent(t.install.androidMenu);
    expect(steps).toHaveTextContent(t.install.androidAdd);
  });

  it.each([
    ['in the installed app', { device: { standalone: true, ios: true } }],
    ['on a desktop browser without a prompt', {}],
    ['once dismissed on this device', { device: { ios: true }, dismissed: true }],
  ])('is not shown %s', (_name, options) => {
    const { platform } = fakeInstallPlatform(options);
    renderWith(platform);
    expect(card()).not.toBeInTheDocument();
  });

  it('remembers Ne zdaj on this device', async () => {
    const { platform, storage } = fakeInstallPlatform({ device: { ios: true } });
    renderWith(platform);

    await userEvent.click(screen.getByRole('button', { name: t.install.notNow }));

    expect(card()).not.toBeInTheDocument();
    expect(createInstallStore(() => storage).getState().dismissed).toBe(true);
  });

  it('hides on appinstalled', () => {
    const { platform, store, firePrompt } = fakeInstallPlatform();
    firePrompt();
    renderWith(platform);
    expect(card()).toBeInTheDocument();

    act(() => store.markInstalled());

    expect(card()).not.toBeInTheDocument();
  });
});
