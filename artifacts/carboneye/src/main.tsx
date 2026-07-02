/**
 * artifacts/carboneye/src/main.tsx — React entry point that mounts the App component to the DOM.
 * Author: Pasquale Marzaioli
 */
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
