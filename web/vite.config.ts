// Purpose: Configure Vite for the PromptCalc React app.
// Persists: None.
// Security Risks: None.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
