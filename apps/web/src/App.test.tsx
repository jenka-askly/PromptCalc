/**
 * Purpose: Validate dev red-team debug profile controls persist and expose profile IDs in the UI.
 * Persists: Reads and writes sessionStorage key promptcalc.redteam.profile.
 * Security Risks: Exercises dev-only red-team UI controls that affect server-side debugging behavior.
 */

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

vi.mock("./components/CalculatorViewer", () => ({
  CalculatorViewer: () => <div data-testid="calculator-viewer" />,
}));

const fetchMock = vi.fn<typeof fetch>();

describe("App red-team profile controls", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            service: "promptcalc-api",
            build: "test",
            traceId: "trace-1",
            redTeamCapabilityAvailable: true,
            auth: { isAuthenticated: true },
          }),
          headers: new Headers(),
        } as Response;
      }

      if (url.includes("/api/calcs")) {
        return {
          ok: true,
          json: async () => [],
          headers: new Headers(),
        } as Response;
      }

      throw new Error(`Unhandled fetch URL in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows debug checks and stores profile", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Dev red-team debug checks")).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Red-team profile enabled"));
    fireEvent.click(screen.getByLabelText(/Generate all collateral when generating/));

    const stored = window.sessionStorage.getItem("promptcalc.redteam.profile");
    expect(stored).toBeTruthy();
    expect(screen.getByText(/profileId:/)).toBeTruthy();
  });
});
