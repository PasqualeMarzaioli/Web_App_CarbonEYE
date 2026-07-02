/**
 * artifacts/carboneye/src/lib/responsive.ts — Layout helper that selects CSS grid column templates based on mobile/desktop viewport (768px breakpoint).
 * Author: Pasquale Marzaioli
 */
// Tiny shared helper for the inline-style-heavy frontend. CSS media queries cannot reach
// React inline styles, so JS-driven layout (grids that collapse, rows that stack) reads
// `useIsMobile()` (768px, from hooks/use-mobile) and picks a column template through this
// helper. Keeping the logic here keeps call sites terse and the breakpoint consistent.

// Pick a `grid-template-columns` value: a single column on mobile, the given desktop
// template otherwise. Usage: `gridTemplateColumns: cols(isMobile, "repeat(4, 1fr)")`.
export function cols(isMobile: boolean, desktop: string, mobile = "1fr"): string {
  return isMobile ? mobile : desktop;
}
