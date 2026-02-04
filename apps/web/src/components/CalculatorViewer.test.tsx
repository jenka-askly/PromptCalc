/**
 * Purpose: Validate CalculatorViewer watchdog readiness handling for sandboxed artifacts.
 * Persists: None.
 * Security Risks: Exercises message handling for untrusted iframe content.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { CalculatorViewer } from "./CalculatorViewer";

const MINIMAL_HTML = "<!doctype html><html><head></head><body>calc</body></html>";
const TEST_TOKEN = "test-token";

const stubHandshakeToken = () => {
  const originalCrypto = globalThis.crypto;
  const mockCrypto = { randomUUID: vi.fn(() => TEST_TOKEN) } as Crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: mockCrypto,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  };
};

describe("CalculatorViewer", () => {
  it("stays ready when the iframe posts READY before watchdog timeout", async () => {
    vi.useFakeTimers();
    const restoreCrypto = stubHandshakeToken();

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={50} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", token: TEST_TOKEN },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(60);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("Ready");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("injects a bootstrap and stays ready when a PONG arrives", async () => {
    vi.useFakeTimers();
    const restoreCrypto = stubHandshakeToken();

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={50} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;
    const srcDoc = iframe.getAttribute("srcdoc") ?? "";

    expect(srcDoc).toContain("promptcalc-ready");

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_PONG", token: TEST_TOKEN },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(60);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("Ready");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("times out when no READY message arrives", async () => {
    vi.useFakeTimers();

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={20} />);

    await vi.advanceTimersByTimeAsync(40);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("WATCHDOG_TIMEOUT");

    vi.useRealTimers();
  });
});
