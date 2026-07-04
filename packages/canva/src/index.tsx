// The Canva app entry — mounts the App UI Kit panel into the side-panel root
// under AppUiProvider (which supplies the Canva theme + tokens the App UI Kit
// components read). Canva loads this bundle in the app iframe; the element with
// id `root` is the panel's mount point (see index.html). This file is the ONLY
// DOM entry — all UI is in app.tsx, all logic in the pure/thin modules.

import { createRoot } from 'react-dom/client';
import { AppUiProvider } from '@canva/app-ui-kit';
import '@canva/app-ui-kit/styles.css';
import { App } from './app.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount element');

createRoot(root).render(
  <AppUiProvider>
    <App />
  </AppUiProvider>,
);
