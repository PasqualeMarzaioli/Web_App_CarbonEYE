/**
 * artifacts/carboneye/src/hooks/use-mobile.tsx — React hook that detects mobile viewport width (768px breakpoint) and updates on window resize events.
 * Author: Pasquale Marzaioli
 */
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Initialize eagerly from the real viewport width so the FIRST render already picks the
  // correct branch — otherwise JS-driven grids (which read this hook) would render their
  // desktop column counts for one frame on a phone before the effect flips them. Guarded
  // for any non-browser render (window undefined → defaults to desktop/false).
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
