import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Gate from "./Gate.jsx";
import { ToastProvider } from "./Toast.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Gate>
      <ToastProvider>
        <App />
      </ToastProvider>
    </Gate>
  </React.StrictMode>
);