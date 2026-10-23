import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>{t.app.name}</h1>
  </StrictMode>,
);
