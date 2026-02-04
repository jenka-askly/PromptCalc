/**
 * Purpose: Provide a sample calculator artifact that hangs to trigger the watchdog.
 * Persists: None.
 * Security Risks: Contains an intentional infinite loop for sandbox demo.
 */

export const BAD_CALC_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bad Calculator</title>
    <style>
      body {
        font-family: "Inter", sans-serif;
        margin: 0;
        padding: 24px;
        background: #fee2e2;
        color: #7f1d1d;
      }
      .card {
        background: #ffffff;
        border: 1px solid #fecaca;
        border-radius: 12px;
        padding: 16px;
        max-width: 360px;
      }
      h2 {
        margin-top: 0;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Bad Calculator (Hang)</h2>
      <p>This calculator never signals ready.</p>
    </div>
    <script>
      while (true) {}
    </script>
  </body>
</html>`;
