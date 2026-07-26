// onboarding.ts — the new-install consent ask. Opened once by the background on
// install. Records the user's choice as their consent (account-canonical when
// signed in — setConsent write-throughs to /v1/iam/consent), marks onboarding
// done so it never reopens, and closes.
import 'webextension-polyfill';
import { setConsent, markOnboarded, capture } from './shared/consent.js';

const runtime: typeof chrome = (globalThis as any).browser ?? (globalThis as any).chrome;

const insights = document.getElementById('ob-insights') as HTMLInputElement | null;
const training = document.getElementById('ob-training') as HTMLInputElement | null;
const cta = document.getElementById('ob-continue') as HTMLButtonElement | null;

cta?.addEventListener('click', async () => {
  const consent = {
    insights: insights?.checked ?? true,
    shareTraining: training?.checked ?? false,
  };
  await setConsent(consent);
  await markOnboarded();
  await capture('onboarding_complete', { shareTraining: consent.shareTraining });
  try {
    const tab = await runtime.tabs.getCurrent();
    if (tab?.id) await runtime.tabs.remove(tab.id);
    else window.close();
  } catch {
    window.close();
  }
});
