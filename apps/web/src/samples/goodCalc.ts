/**
 * Purpose: Provide a safe sample calculator artifact that signals readiness.
 * Persists: None.
 * Security Risks: Contains inline HTML/JS used for sandboxed rendering demo.
 */

export const GOOD_CALC_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Offline Calculator</title>
    <style>
      body {
        font-family: "Inter", sans-serif;
        margin: 0;
        padding: 24px;
        background: #f8fafc;
        color: #0f172a;
      }
      .card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        max-width: 360px;
      }
      label {
        display: block;
        font-weight: 600;
        margin-top: 12px;
      }
      input {
        width: 100%;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid #cbd5f5;
        margin-top: 4px;
      }
      button {
        margin-top: 16px;
        padding: 10px 14px;
        border-radius: 8px;
        border: none;
        background: #2563eb;
        color: #ffffff;
        font-weight: 600;
        cursor: pointer;
      }
      .result {
        margin-top: 12px;
        font-size: 18px;
        font-weight: 600;
      }
      footer {
        margin-top: 16px;
        font-size: 12px;
        color: #475569;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Offline Add Calculator</h2>
      <label for="left">First number</label>
      <input id="left" type="number" value="0" />
      <label for="right">Second number</label>
      <input id="right" type="number" value="0" />
      <button id="calc">Add</button>
      <div class="result" id="result">Result: 0</div>
      <footer>Generated calculator (offline). Do not enter passwords.</footer>
    </div>
    <script>
      const left = document.getElementById("left");
      const right = document.getElementById("right");
      const button = document.getElementById("calc");
      const result = document.getElementById("result");

      const update = () => {
        const leftValue = Number(left.value) || 0;
        const rightValue = Number(right.value) || 0;
        result.textContent = "Result: " + (leftValue + rightValue);
      };

      button.addEventListener("click", update);
      window.addEventListener("load", () => {
        update();
        window.parent.postMessage({ type: "ready" }, "*");
      });
    </script>
  </body>
</html>`;
