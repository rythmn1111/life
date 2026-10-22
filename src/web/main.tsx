import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { App } from "./app";
import * as kit from "./kit";
import { applyTheme, cachedTheme } from "./theme";

// What widgets import. They're compiled with these left out (src/layer.ts) and get the
// dashboard's own copies here, so there's one React and one kit.
(globalThis as any).__life = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react/jsx-dev-runtime": jsxRuntime,
  "react-dom": ReactDOM,
  "@life/kit": kit,
};

applyTheme(cachedTheme());
createRoot(document.getElementById("root")!).render(<App />);
