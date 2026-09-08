import { Route, Routes } from "react-router-dom";
import { MeProvider } from "./lib/MeContext";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import WebsitePage from "./pages/WebsitePage";
import AccountPage from "./pages/AccountPage";
import PricingPage from "./pages/PricingPage";
import BillPage from "./pages/BillPage";

// /bill/:token is a public Bill of Service link (CLAUDE.md's "Bill of
// Service" section) — sent to people who may have no Client Hub account
// at all, so it must never go through MeProvider's auth gate the way
// every other route here does. Kept as a sibling top-level route (its own
// nested <Routes>, react-router v6 handles this natively) rather than
// nesting it inside the authenticated tree.
function AuthenticatedApp() {
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

function App() {
  return (
    <Routes>
      <Route path="/bill/:token" element={<BillPage />} />
      <Route path="/*" element={<AuthenticatedApp />} />
    </Routes>
  );
}

export default App;
