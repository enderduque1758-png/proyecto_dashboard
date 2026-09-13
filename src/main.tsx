import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import GlobalMarketMonitor from './GlobalMarketMonitor';
import './index.css';
import './global-monitor.css';
import './alerts.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalMarketMonitor />
    <App />
  </StrictMode>,
);
