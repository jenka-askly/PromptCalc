/**
 * Purpose: Validate dev red-team debug profile controls persist and expose profile IDs in the UI.
 * Persists: Reads and writes sessionStorage key promptcalc.redteam.profile when red-team capability is enabled.
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

const mockFetch = (redTeamCapabilityAvailable: boolean) => {
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
          redTeamCapabilityAvailable,
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
};

describe("App red-team profile controls", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows debug checks and stores profile", async () => {
    mockFetch(true);
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

  it("restores a saved profile when red-team capability is enabled", async () => {
    window.sessionStorage.setItem(
      "promptcalc.redteam.profile",
      JSON.stringify({ enabled: true, scanMode: "off", dumpCollateral: true })
    );
    mockFetch(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Dev red-team debug checks")).toBeTruthy();
    });

    expect((screen.getByLabelText("Red-team profile enabled") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Generate all collateral when generating/) as HTMLInputElement).checked).toBe(true);
  });
});
