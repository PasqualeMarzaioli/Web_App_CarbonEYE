/**
 * artifacts/carboneye/src/App.tsx — Main application router with lazy-loaded pages, authentication guards, and role-based access control for user and admin dashboards.
 * Author: Pasquale Marzaioli
 */
import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";

const queryClient = new QueryClient();
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Verify = lazy(() => import("./pages/Verify").then((m) => ({ default: m.Verify })));
const Plans = lazy(() => import("./pages/Plans").then((m) => ({ default: m.Plans })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const ForgotPassword = lazy(() =>
  import("./pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazy(() =>
  import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })),
);
const VerifyEmail = lazy(() =>
  import("./pages/VerifyEmail").then((m) => ({ default: m.VerifyEmail })),
);
const UserPortal = lazy(() => import("./pages/UserPortal").then((m) => ({ default: m.UserPortal })));
const AdminConsole = lazy(() =>
  import("./pages/AdminConsole").then((m) => ({ default: m.AdminConsole })),
);
const ContactUs = lazy(() => import("./pages/ContactUs").then((m) => ({ default: m.ContactUs })));

function RequireAuth({
  role,
  children,
}: {
  role?: "admin" | "user";
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--c-bg-page)",
          fontSize: 13,
          color: "var(--c-text-muted)",
        }}
      >
        Loading…
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  if (role && user.role !== role) {
    return <Redirect to={user.role === "admin" ? "/admin" : "/portal"} />;
  }
  return <>{children}</>;
}

function DashboardRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <Redirect to={user.role === "admin" ? "/admin" : "/portal"} />;
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--c-bg-page)",
        fontSize: 13,
        color: "var(--c-text-muted)",
      }}
    >
      Loading…
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/" component={Landing} />
              <Route path="/login" component={Login} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/verify-email" component={VerifyEmail} />
              <Route path="/verify" component={Verify} />
              <Route path="/plans" component={Plans} />
              <Route path="/dashboard" component={DashboardRedirect} />
              <Route path="/portal">
                <RequireAuth role="user">
                  <UserPortal />
                </RequireAuth>
              </Route>
              <Route path="/admin">
                <RequireAuth role="admin">
                  <AdminConsole />
                </RequireAuth>
              </Route>
              <Route path="/contact" component={ContactUs} />
              <Route>
                <Landing />
              </Route>
            </Switch>
          </Suspense>
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
