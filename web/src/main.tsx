import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./margin/margin.css";
import "./app.css";
import { Landing } from "./pages/Landing";
import { HostPage } from "./pages/HostPage";
import { StagePage } from "./pages/StagePage";
import { FollowPage } from "./pages/FollowPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/show/:showId/host" element={<HostPage />} />
        <Route path="/show/:showId/stage" element={<StagePage />} />
        <Route path="/show/:showId/follow" element={<FollowPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
