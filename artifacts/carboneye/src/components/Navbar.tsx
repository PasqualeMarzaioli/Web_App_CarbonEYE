/**
 * artifacts/carboneye/src/components/Navbar.tsx — Navigation header with responsive menu (hamburger on mobile), role-based links, and live status indicator.
 * Author: Pasquale Marzaioli
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../lib/auth";
import { useIsMobile } from "../hooks/use-mobile";

export function Navbar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const base = import.meta.env.BASE_URL;
  const isMobile = useIsMobile();
  // Mobile-only dropdown menu state. Desktop never reads this.
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the dropdown whenever the route changes (e.g. after tapping a link), so the
  // menu never lingers open over the new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  const navLink = (href: string, label: string) => {
    const active = location === href;
    return (
      <Link
        href={href}
        onClick={() => setMenuOpen(false)}
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: active ? "var(--c-green-dark)" : "var(--c-text-muted)",
          textDecoration: "none",
          padding: "8px 14px",
          borderRadius: 8,
          background: active ? "var(--c-bg-page)" : "transparent",
          // On mobile each link is a full-width row in the dropdown panel.
          display: isMobile ? "block" : undefined,
        }}
      >
        {label}
      </Link>
    );
  };

  const dashHref = user ? (user.role === "admin" ? "/admin" : "/portal") : "/login";

  // The nav links, shared by the desktop row and the mobile dropdown. Order:
  // HOME · DASHBOARD · VERIFY · PLANS · CONTACT · SIGN IN.
  const links = (
    <>
      {navLink("/", "Home")}
      {navLink(dashHref, user?.role === "admin" ? "Admin" : "Dashboard")}
      {navLink("/verify", "Verify")}
      {navLink("/plans", "Plans")}
      {navLink("/contact", "Contact")}
      {!user && navLink("/login", "Sign in")}
    </>
  );

  return (
    <header className="header" style={{ position: "relative" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center" }}>
        <img src={`${base}logo.png`} alt="CarbonEYE" />
      </Link>

      {isMobile ? (
        <>
          {/* Hamburger toggle — the only nav control visible on phones. */}
          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              background: "transparent",
              border: "1px solid var(--c-border)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 20,
              lineHeight: 1,
              color: "var(--c-text-muted)",
              cursor: "pointer",
            }}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

          {/* Full-width dropdown panel below the header. */}
          {menuOpen && (
            <nav
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                background: "var(--c-white)",
                borderBottom: "2px solid var(--c-border)",
                boxShadow: "0 8px 20px rgba(27,122,46,0.10)",
                padding: "10px 16px 16px",
                zIndex: 50,
              }}
            >
              {links}
            </nav>
          )}
        </>
      ) : (
        <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {links}
          {/* The "LIVE" pill is hidden on mobile to keep the header compact. */}
          <div className="live-pill" style={{ marginLeft: 18 }}>
            <div className="live-dot" />
            <span className="live-text">LIVE · Azure Cloud</span>
          </div>
        </nav>
      )}
    </header>
  );
}
