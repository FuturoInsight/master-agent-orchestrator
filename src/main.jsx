import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import MasterOrchestrator from "./MasterOrchestratorDashboard.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MasterOrchestrator />
  </StrictMode>
);
