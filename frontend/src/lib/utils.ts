import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { formatBDT } from "./format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
