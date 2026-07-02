/**
 * artifacts/carboneye/src/pages/Landing.tsx — Public homepage showcasing CarbonEYE's ESG certificate platform, features (satellite, IoT, AI), sample certificate, and call-to-action buttons.
 * Author: Pasquale Marzaioli
 */
import { Link } from "wouter";
import { Navbar } from "../components/Navbar";
import { ScoreCard } from "../components/ScoreCard";

function Feature({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div
      style={{
        background: "var(--c-white)",
        borderRadius: 14,
        border: "1px solid var(--c-border)",
        padding: "26px 24px",
        boxShadow: "0 4px 16px rgba(27,122,46,0.06)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "linear-gradient(135deg, var(--c-green-light), var(--c-green-mid))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 18,
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text)", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "var(--c-text-muted)", lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 36,
          fontWeight: 700,
          color: "var(--c-green-dark)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--c-text-muted)",
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />

      {/* Hero */}
      <section
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "72px 28px 56px",
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 56,
          alignItems: "center",
        }}
        className="hero"
      >
        <div>
          <div className="section-title" style={{ marginBottom: 18 }}>
            Global Emissions Verification Network
          </div>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.05,
              margin: 0,
              letterSpacing: "-0.02em",
              color: "var(--c-text)",
            }}
          >
            Truth is not declared,
            <br />
            it's{" "}
            <span
              style={{
                background: "linear-gradient(135deg, var(--c-green-light), var(--c-green-dark))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              measured.
            </span>
          </h1>
          <p
            style={{
              fontSize: 17,
              color: "var(--c-text-muted)",
              lineHeight: 1.7,
              marginTop: 22,
              maxWidth: 540,
            }}
          >
            CarbonEYE fuses satellite imagery, ground IoT sensors and AI models to produce
            verified ESG certificates in real time. No greenwashing. No self-reported numbers.
            Just measured truth.
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 32, flexWrap: "wrap" }}>
            <Link
              href="/dashboard"
              style={{
                display: "inline-block",
                padding: "14px 26px",
                background: "linear-gradient(135deg, var(--c-green-light), var(--c-green-mid))",
                color: "white",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textDecoration: "none",
                boxShadow: "0 6px 20px rgba(39,174,96,0.35)",
              }}
            >
              Launch Dashboard
            </Link>
            <a
              href="#how"
              style={{
                display: "inline-block",
                padding: "14px 26px",
                background: "var(--c-white)",
                color: "var(--c-text)",
                border: "1px solid var(--c-border)",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              How it works
            </a>
          </div>

          <div style={{ display: "flex", gap: 40, marginTop: 48, flexWrap: "wrap", rowGap: 20 }}>
            <Stat value="24h" label="Telemetry Refresh" />
            <Stat value="3" label="Data layers fused" />
            <Stat value="100%" label="Verifiable Proofs" />
          </div>
        </div>

        <div
          style={{
            background: "var(--c-white)",
            borderRadius: 18,
            padding: 32,
            border: "1px solid var(--c-border)",
            boxShadow: "0 12px 40px rgba(27,122,46,0.12)",
          }}
        >
          <div className="section-title" style={{ marginBottom: 16 }}>
            Sample Certificate
          </div>
          <ScoreCard score={87} grade="A" company="Example Corp" timestamp={new Date().toISOString()} />
          <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between" }}>
            <Stat value="0.62" label="NDVI" />
            <Stat value="1842" label="CH4 ppb" />
            <Stat value="412" label="CO2 ppm" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="how" style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 28px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div className="section-title">How CarbonEYE works</div>
          <h2
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "var(--c-text)",
              margin: "10px 0 0",
              letterSpacing: "-0.01em",
            }}
          >
            Three layers of evidence. One verified score.
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }} className="feat-grid">
          <Feature
            icon="①"
            title="Satellite Monitoring"
            body="Sentinel-2 imagery feeds NDVI, NDWI and NBR over the asset's footprint; atmospheric CH4 and CO2 are cross-checked with ICOS and OpenAQ when available."
          />
          <Feature
            icon="②"
            title="Ground IoT Sensors"
            body="Distributed sensor mesh provides ground-truth telemetry: CO2, CH4, temperature and humidity, calibrated against orbital data."
          />
          <Feature
            icon="③"
            title="AI Verification"
            body="Advanced anomaly detection correlates multispectral imagery with IoT telemetry, safeguarding against greenwashing while ensuring full alignment with regulatory frameworks."
          />
        </div>
      </section>

      {/* CTA strip */}
      <section
        style={{
          background: "linear-gradient(135deg, var(--c-green-dark), var(--c-green-mid))",
          padding: "56px 28px",
          textAlign: "center",
          color: "white",
        }}
      >
        <h3 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
          Ready to measure your real impact?
        </h3>
        <p style={{ fontSize: 15, opacity: 0.9, maxWidth: 560, margin: "12px auto 26px" }}>
          Generate your first verified ESG certificate in few minutes. No installation required.
        </p>
        <Link
          href="/dashboard"
          style={{
            display: "inline-block",
            padding: "14px 30px",
            background: "var(--c-white)",
            color: "var(--c-green-dark)",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textDecoration: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          }}
        >
          Open the Dashboard
        </Link>
      </section>

      <footer
        style={{
          padding: "28px 28px 40px",
          textAlign: "center",
          color: "var(--c-text-muted)",
          fontSize: 12,
          letterSpacing: "0.04em",
        }}
      >
        © {new Date().getFullYear()} CarbonEYE — Truth is not declared, it's measured.
      </footer>
    </div>
  );
}
