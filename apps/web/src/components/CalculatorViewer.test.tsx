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
const stubHandshakeToken = (tokens: string[]) => {
  const originalCrypto = globalThis.crypto;
  const mockCrypto = {
    randomUUID: vi.fn(() => tokens.shift() ?? "missing-token"),
  } as Crypto;
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
  it("stays ready when the iframe posts READY with matching loadId/token", async () => {
    vi.useFakeTimers();
    const loadId = "load-1";
    const token = "token-1";
    const restoreCrypto = stubHandshakeToken([loadId, token]);

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={50} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId, token },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(60);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("Ready");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("injects a bootstrap and stays ready when a READY arrives", async () => {
    vi.useFakeTimers();
    const loadId = "load-2";
    const token = "token-2";
    const restoreCrypto = stubHandshakeToken([loadId, token]);

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={50} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;
    const srcDoc = iframe.getAttribute("srcdoc") ?? "";

    expect(srcDoc).toContain("promptcalc-ready");

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId, token },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(60);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("Ready");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("ignores READY messages with the wrong loadId", async () => {
    vi.useFakeTimers();
    const loadId = "load-3";
    const token = "token-3";
    const restoreCrypto = stubHandshakeToken([loadId, token]);

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={30} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId: "wrong-load", token },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(40);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("WATCHDOG_TIMEOUT");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("ignores READY messages with the wrong token", async () => {
    vi.useFakeTimers();
    const loadId = "load-4";
    const token = "token-4";
    const restoreCrypto = stubHandshakeToken([loadId, token]);

    const { container } = render(<CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={30} />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;

    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId, token: "wrong-token" },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(40);

    const statusText = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(statusText).toContain("WATCHDOG_TIMEOUT");

    restoreCrypto();
    vi.useRealTimers();
  });

  it("ignores READY from a previous load after starting a new one", async () => {
    vi.useFakeTimers();
    const loadId1 = "load-5";
    const token1 = "token-5";
    const loadId2 = "load-6";
    const token2 = "token-6";
    const restoreCrypto = stubHandshakeToken([loadId1, token1, loadId2, token2]);

    const { container, rerender } = render(
      <CalculatorViewer artifactHtml={MINIMAL_HTML} timeoutMs={50} />
    );
    rerender(<CalculatorViewer artifactHtml={`${MINIMAL_HTML}v2`} timeoutMs={50} />);

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeWindow = new EventTarget() as unknown as Window;
    Object.defineProperty(iframe, "contentWindow", { value: fakeWindow });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId: loadId1, token: token1 },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(10);

    const loadingStatus = container.querySelector(".viewer-status")?.textContent ?? "";
    expect(loadingStatus).toContain("Loading");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "PROMPTCALC_READY", loadId: loadId2, token: token2 },
        source: fakeWindow as unknown as MessageEventSource,
      })
    );

    await vi.advanceTimersByTimeAsync(10);

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
