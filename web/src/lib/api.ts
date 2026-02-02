// Purpose: Provide placeholder API wrappers for the frontend.
// Persists: None.
// Security Risks: Will eventually handle authenticated requests.

const BASE_URL = import.meta.env.VITE_API_BASE ?? 'http://localhost:7071/api';

export async function getHealth(): Promise<{ status: string }> {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error('Health check failed');
  }
  return response.json();
}

export async function generateCalc(prompt: string): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });
  return response.json();
}
