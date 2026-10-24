import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { store } from './store/store';
import './styles/theme.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

// Expose the store in dev for debugging/inspection in the console.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = store;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
