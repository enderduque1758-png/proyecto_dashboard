import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SustainedTracker from './SustainedTracker';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <SustainedTracker />
  </StrictMode>,
);
