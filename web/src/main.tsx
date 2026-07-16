import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { startBackgroundSync } from "./lib/sync";
import { initServiceWorkerUpdates } from "./lib/swUpdate";
import "./styles/index.css";

startBackgroundSync();
initServiceWorkerUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
