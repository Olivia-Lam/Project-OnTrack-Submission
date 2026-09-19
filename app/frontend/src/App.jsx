import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Train from "./pages/Train.jsx";
import StationDetail from "./pages/StationDetail.jsx";
import JourneyPlanner from "./pages/JourneyPlanner.jsx";
import SavedRoutes from "./pages/SavedRoutes.jsx";
import BottomNav from "./components/BottomNav.jsx";
import { ThemeContext, useTheme } from "./hooks/useTheme.js";

// Phone-width column: content scrolls in .screen-area, BottomNav stays pinned below it.
export default function App() {
  const themeState = useTheme();
  return (
    <ThemeContext.Provider value={themeState}>
    <div className="sgds:mx-auto sgds:flex sgds:min-h-full sgds:w-full sgds:max-w-container-md sgds:flex-col sgds:bg-default">
      <div className="sgds:flex-1 sgds:overflow-y-auto sgds:pb-2">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/train" element={<Train />} />
          <Route path="/train/:stationCode" element={<StationDetail />} />
          <Route path="/journey-planner" element={<JourneyPlanner />} />
          <Route path="/saved" element={<SavedRoutes />} />
          <Route path="*" element={<Navigate to="/" replace />} /> {/* e.g. the removed /bus link */}
        </Routes>
      </div>
      <BottomNav />
    </div>
    </ThemeContext.Provider>
  );
}
