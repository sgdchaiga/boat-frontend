import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import './index.css';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const slowConnection = connection?.saveData || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g";
    const register = () => {
      void navigator.serviceWorker.register("/sw.js?v=4");
    };
    if (slowConnection) {
      window.setTimeout(register, 5000);
    } else if (window.requestIdleCallback) {
      window.requestIdleCallback(register, { timeout: 3000 });
    } else {
      window.setTimeout(register, 1500);
    }
  });
}
