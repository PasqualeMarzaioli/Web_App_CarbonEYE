/**
 * artifacts/carboneye/src/lib/utils.ts — Utility function combining clsx and tailwind-merge for CSS class name merging.
 * Author: Pasquale Marzaioli
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
