import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const stylesDir = path.resolve(__dirname);
const sheets = [
  ...readdirSync(stylesDir).filter((file) => file.endsWith(".css")),
  ...readdirSync(path.join(stylesDir, "pages")).map((file) => path.join("pages", file)),
].filter((file) => file !== "tokens.css");

const read = (file: string) => readFileSync(path.join(stylesDir, file), "utf8");

// The receipt mimics thermal paper and the login story sits on a fixed dark gradient.
const HEX_ALLOWED = ["pages/pos.css", "pages/auth.css"];

describe("design system guardrails (plan §7)", () => {
  it.each(sheets)("%s never sets text below 12px", (file) => {
    const tooSmall = [...read(file).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter(([, size]) => Number(size) < 12);
    expect(tooSmall.map(([match]) => match)).toEqual([]);
  });

  it.each(sheets.filter((file) => !HEX_ALLOWED.some((allowed) => file.replaceAll("\\", "/") === allowed)))(
    "%s uses tokens instead of raw hex colors",
    (file) => {
      expect(read(file).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    },
  );
});
