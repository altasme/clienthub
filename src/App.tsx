import { Route, Routes } from "react-router-dom";
import { MeProvider } from "./lib/MeContext";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import WebsitePage from "./pages/WebsitePage";
import AccountPage from "./pages/AccountPage";
import PricingPage from "./pages/PricingPage";

function App() {
  return (
    <MeProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>
      </Routes>
    </MeProvider>
  );
}

export default App;
