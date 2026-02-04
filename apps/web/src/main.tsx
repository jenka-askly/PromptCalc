/**
 * Purpose: Bootstrap the PromptCalc React application.
 * Persists: None.
 * Security Risks: None.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
