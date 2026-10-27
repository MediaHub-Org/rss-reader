import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './store/store';
import './styles/theme.css';
import './styles/app.css';
import './styles/responsive.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// No browser right-click menu over the app chrome -- it's not a webpage with
// selectable prose, it's an app UI. Inputs keep the native menu (paste,
// spellcheck), and so does article prose inside `.content`: there the app
// offers its own menu for links while leaving text selection/copy intact.
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('input, textarea, [contenteditable="true"], .content')) {
    event.preventDefault();
  }
});

// Expose the store in dev for debugging/inspection in the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = store;
}

// Register the app-shell service worker so the installed app boots instantly
// and keeps working offline. Production only — never during development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
