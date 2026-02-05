/**
 * Purpose: Validate red-team arming controls require explicit confirmation before enabling bypass mode.
 * Persists: Reads and writes sessionStorage key promptcalc.redteam.armed.
 * Security Risks: Exercises UI control flow for dev-only safety override arming.
 */

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

vi.mock("./components/CalculatorViewer", () => ({
  CalculatorViewer: () => <div data-testid="calculator-viewer" />,
}));

const fetchMock = vi.fn<typeof fetch>();

describe("App red-team arming", () => {
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

  it("keeps red-team override disabled until Enable is confirmed", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Bypass AI scan blocks (red team)")).toBeTruthy();
    });

    const yesOption = screen.getByRole("radio", { name: "Yes" });
    fireEvent.click(yesOption);

    expect(screen.getByText("Enable red-team override?")).toBeTruthy();
    expect(screen.getByText("Not armed")).toBeTruthy();
    expect(window.sessionStorage.getItem("promptcalc.redteam.armed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByText("Armed")).toBeTruthy();
    });
    expect(window.sessionStorage.getItem("promptcalc.redteam.armed")).toBe("1");

    const noOption = screen.getByRole("radio", { name: "No" });
    fireEvent.click(noOption);

    await waitFor(() => {
      expect(screen.getByText("Not armed")).toBeTruthy();
    });
    expect(window.sessionStorage.getItem("promptcalc.redteam.armed")).toBeNull();
  });
});
