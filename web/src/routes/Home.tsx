// Purpose: Provide the landing page prompt placeholder.
// Persists: None.
// Security Risks: None.

import Placeholder from '../components/Placeholder';

export default function Home() {
  return (
    <main>
      <Placeholder
        title="PromptCalc"
        description="Describe the calculator you want to build. Generation is stubbed in this scaffold."
      />
      <label htmlFor="prompt">Prompt</label>
      <textarea id="prompt" name="prompt" rows={4} placeholder="e.g., Split a dinner bill with tax and tip" />
      <button type="button">Generate (stub)</button>
    </main>
  );
}
