// The app root: Polaris AppProvider wrapping the assistant. Polaris needs its
// AppProvider (theme + i18n) at the root; App Bridge is loaded by the CDN script
// in index.html (it registers the global `window.shopify`), so there is no React
// provider for it — components read the session token through the authenticated
// fetch built in main.tsx. This file is deliberately thin: it wires the provider
// and hands the built Api + launch context to the Assistant.

import type { JSX } from 'react';
import { AppProvider, Page, Text, BlockStack, Banner } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { Assistant } from './Assistant';
import type { Api } from './api';
import type { LaunchContext } from './context';

export interface AppProps {
  api: Api;
  ctx: LaunchContext;
}

export function App({ api, ctx }: AppProps): JSX.Element {
  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Hanzo AI">
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Generate product content, handle orders, and ask about your store — powered by the Hanzo model gateway.
          </Text>
          {!ctx.shop && (
            <Banner tone="warning">
              No shop context. Open this app from your Shopify admin so it can act on your store.
            </Banner>
          )}
          <Assistant api={api} ctx={ctx} />
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
