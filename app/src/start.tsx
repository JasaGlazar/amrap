import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { StartupErrorPage } from './pages/StartupErrorPage';

// The router module pulls in the Supabase client, which throws at import time when the
// environment is not configured. Importing it here lets that failure render a message instead of
// leaving a blank page.
export async function start(container: HTMLElement): Promise<void> {
  const root = createRoot(container);
  try {
    const { routes } = await import('./routes');
    root.render(
      <StrictMode>
        <RouterProvider router={createBrowserRouter(routes)} />
      </StrictMode>,
    );
  } catch (error) {
    console.error('app failed to start', error);
    root.render(<StartupErrorPage error={error} />);
  }
}
