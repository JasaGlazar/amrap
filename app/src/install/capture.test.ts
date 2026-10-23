import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferredChoice, fakePromptEvent, memoryStorage } from '../test/fakeInstall';
import { createInstallStore, listenForInstallPrompt } from './capture';

afterEach(() => vi.restoreAllMocks());

describe('listenForInstallPrompt', () => {
  it('keeps the browser prompt for later and stops the default mini-infobar', () => {
    const target = new EventTarget();
    const store = createInstallStore(() => memoryStorage());
    listenForInstallPrompt(target, store);
    const event = fakePromptEvent('accepted');

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().prompt).toBe(event);
  });

  it('drops the prompt and remembers the install on appinstalled', () => {
    const target = new EventTarget();
    const store = createInstallStore(() => memoryStorage());
    listenForInstallPrompt(target, store);
    target.dispatchEvent(fakePromptEvent('accepted'));

    target.dispatchEvent(new Event('appinstalled'));

    expect(store.getState()).toMatchObject({ prompt: null, installed: true });
  });
});

describe('createInstallStore', () => {
  it('reads an earlier dismissal from storage', () => {
    const storage = memoryStorage();
    createInstallStore(() => storage).dismiss();
    expect(createInstallStore(() => storage).getState().dismissed).toBe(true);
  });

  it.each([
    ['appinstalled', (store: ReturnType<typeof createInstallStore>) => store.markInstalled()],
    [
      'an accepted prompt',
      async (store: ReturnType<typeof createInstallStore>) => {
        store.capture(fakePromptEvent('accepted'));
        await store.install();
      },
    ],
  ])('remembers an install on this device after %s', async (_name, install) => {
    const storage = memoryStorage();
    await install(createInstallStore(() => storage));
    expect(createInstallStore(() => storage).getState().installed).toBe(true);
  });

  it('does not remember a declined prompt as an install', async () => {
    const storage = memoryStorage();
    const store = createInstallStore(() => storage);
    store.capture(fakePromptEvent('dismissed'));
    await store.install();
    expect(createInstallStore(() => storage).getState().installed).toBe(false);
  });

  it('notifies subscribers with a new state on every change', () => {
    const store = createInstallStore(() => memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();

    store.capture(fakePromptEvent('accepted'));
    store.dismiss();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState()).not.toBe(before);
    expect(store.getState().dismissed).toBe(true);
  });

  it('shows the prompt once and counts an accepted install as installed', async () => {
    const store = createInstallStore(() => memoryStorage());
    const event = fakePromptEvent('accepted');
    store.capture(event);

    await expect(store.install()).resolves.toBe('accepted');

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ prompt: null, installed: true });
  });

  it('keeps the prompt while the browser dialog is open and drops it after the answer', async () => {
    const store = createInstallStore(() => memoryStorage());
    const { userChoice, answer } = deferredChoice();
    const event = fakePromptEvent('dismissed', userChoice);
    store.capture(event);

    const pending = store.install();

    expect(event.prompt).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(store.getState().prompt).toBe(event);
    answer('dismissed');
    await expect(pending).resolves.toBe('dismissed');
    expect(store.getState().prompt).toBeNull();
  });

  it('does not show the prompt a second time while the dialog is open', async () => {
    const store = createInstallStore(() => memoryStorage());
    const { userChoice, answer } = deferredChoice();
    const event = fakePromptEvent('accepted', userChoice);
    store.capture(event);

    const first = store.install();
    await expect(store.install()).resolves.toBe('unavailable');
    answer('accepted');

    await expect(first).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('drops a used prompt that the user declined', async () => {
    const store = createInstallStore(() => memoryStorage());
    store.capture(fakePromptEvent('dismissed'));

    await expect(store.install()).resolves.toBe('dismissed');

    expect(store.getState()).toMatchObject({ prompt: null, installed: false });
  });

  it('reports a prompt the browser refuses to show as unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createInstallStore(() => memoryStorage());
    const event = fakePromptEvent('accepted');
    event.prompt.mockRejectedValueOnce(new DOMException('already shown', 'InvalidStateError'));
    store.capture(event);

    await expect(store.install()).resolves.toBe('unavailable');
    expect(store.getState().prompt).toBeNull();
  });

  it('is unavailable without a captured prompt', async () => {
    const store = createInstallStore(() => memoryStorage());
    await expect(store.install()).resolves.toBe('unavailable');
  });
});
