// Purpose: Define top-level routes for the PromptCalc web app.
// Persists: None.
// Security Risks: None.

import { Routes, Route } from 'react-router-dom';
import Home from './routes/Home';
import Gate from './routes/Gate';
import CalcPage from './routes/CalcPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/gate" element={<Gate />} />
      <Route path="/c/:id" element={<CalcPage />} />
    </Routes>
  );
}
