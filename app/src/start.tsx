import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Not 'react-router/dom', so the tests and the app render the same RouterProvider.
import { createBrowserRouter, RouterProvider } from 'react-router';
import { StartupErrorPage } from './pages/StartupErrorPage';

export async function start(container: HTMLElement): Promise<void> {
  const root = createRoot(container);
  try {
    // Dynamic: the Supabase client throws at import time without its env vars.
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
