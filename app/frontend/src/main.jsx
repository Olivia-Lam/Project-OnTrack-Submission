// Must stay first: the package entry registers every <sgds-*> element with an unguarded
// customElements.define, which throws if the /react wrappers (imported via App) registered first.
import "@govtechsg/sgds-web-component";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./sgds-foundation.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
