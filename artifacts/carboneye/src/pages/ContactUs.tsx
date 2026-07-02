/**
 * artifacts/carboneye/src/pages/ContactUs.tsx — Contact form page with company details and structured form for inquiries, support, and partnership requests.
 * Author: Pasquale Marzaioli
 */
import { useState } from "react";
import { Navbar } from "../components/Navbar";
import { useIsMobile } from "../hooks/use-mobile";
import { cols } from "../lib/responsive";

const SUBJECTS = [
  "General enquiry",
  "Certificate request",
  "Technical support",
  "Partnership / Integration",
  "Press & media",
  "Other",
];

type FormState = {
  name: string;
  email: string;
  company: string;
  subject: string;
  message: string;
};

const EMPTY: FormState = { name: "", email: "", company: "", subject: "", message: "" };

export function ContactUs() {
  const isMobile = useIsMobile();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
      setForm(EMPTY);
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg-page)" }}>
      <Navbar />

      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: isMobile ? "40px 16px 64px" : "60px 24px 80px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div
            className="section-title"
            style={{ marginBottom: 10, color: "var(--c-green-mid)" }}
          >
            Get in touch
          </div>
          <h1 style={{ fontSize: 38, fontWeight: 800, margin: "0 0 14px", color: "var(--c-text)" }}>
            Contact us
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "var(--c-text-muted)",
              maxWidth: 540,
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            Have a question about certification, a technical issue, or want to explore a
            partnership? We'll get back to you within one business day.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: cols(isMobile, "1fr 1.6fr"),
            gap: isMobile ? 24 : 40,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {[
              {
                icon: "📍",
                title: "Office",
                text: "CarbonEYE S.r.l.\nVia della Transizione Ecologica 12\n20121 Milan, Italy",
              },
              {
                icon: "✉️",
                title: "Email",
                text: "pasquale.marzaioli02@gmail.com",
              },
              {
                icon: "📞",
                title: "Phone",
                text: "+39 3456039155\nMon – Fri, 9:00 – 18:00 CET",
              },
            ].map((item) => (
              <div
                key={item.title}
                style={{
                  background: "var(--c-white)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 14,
                  padding: "18px 20px",
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ fontSize: 22, marginTop: 1 }}>{item.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "var(--c-text)", marginBottom: 4 }}>
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--c-text-muted)",
                      whiteSpace: "pre-line",
                      lineHeight: 1.6,
                    }}
                  >
                    {item.text}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: "var(--c-white)",
              border: "1px solid var(--c-border)",
              borderRadius: 16,
              padding: "36px 36px 32px",
            }}
          >
            {sent ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 10px", color: "var(--c-text)" }}>
                  Message sent!
                </h2>
                <p style={{ fontSize: 14, color: "var(--c-text-muted)", marginBottom: 28, lineHeight: 1.6 }}>
                  Thank you for reaching out. We'll be in touch within one business day.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setSent(false)}
                  style={{ fontSize: 13 }}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ marginBottom: 6 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "var(--c-text)" }}>
                    Send us a message
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--c-text-muted)", margin: 0 }}>
                    All fields marked * are required.
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: cols(isMobile, "1fr 1fr"), gap: 14 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="label-text">Full name *</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="Mario Rossi"
                      value={form.name}
                      onChange={set("name")}
                      required
                      maxLength={255}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="label-text">Email address *</span>
                    <input
                      className="input"
                      type="email"
                      placeholder="mario@example.com"
                      value={form.email}
                      onChange={set("email")}
                      required
                      maxLength={255}
                    />
                  </label>
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="label-text">Company / Organisation</span>
                  <input
                    className="input"
                    type="text"
                    placeholder="Acme S.r.l. (optional)"
                    value={form.company}
                    onChange={set("company")}
                    maxLength={255}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="label-text">Subject *</span>
                  <select
                    className="input"
                    value={form.subject}
                    onChange={set("subject")}
                    required
                    style={{ cursor: "pointer" }}
                  >
                    <option value="">Select a topic…</option>
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="label-text">Message *</span>
                  <textarea
                    className="input"
                    placeholder="Tell us how we can help…"
                    value={form.message}
                    onChange={set("message")}
                    required
                    minLength={10}
                    maxLength={5000}
                    rows={5}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                  />
                  <span style={{ fontSize: 11, color: "var(--c-text-muted)", textAlign: "right" }}>
                    {form.message.length} / 5000
                  </span>
                </label>

                {error && (
                  <div className="alert alert-err">{error}</div>
                )}

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting}
                  style={{ fontSize: 14, padding: "12px 0" }}
                >
                  {submitting ? "Sending…" : "Send message"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
