import { actionLabel, dhakaDateISO, formatBDT, formatDateTime, formatPercent, formatRelative, initials, label } from "./format";

describe("formatting", () => {
  it("formats taka with lakh grouping and no stray space", () => {
    expect(formatBDT(5700)).toBe("৳5,700");
    expect(formatBDT("125000.00")).toBe("৳1,25,000");
    expect(formatBDT(-120)).toBe("−৳120");
    expect(formatBDT("2490.5", { precise: true })).toBe("৳2,490.50");
    expect(formatBDT(undefined)).toBe("৳0");
  });

  it("shows times in Dhaka regardless of the device zone", () => {
    // 18:30 UTC is 00:30 the next day in Dhaka (UTC+6).
    expect(formatDateTime("2026-10-08T18:30:00Z")).toBe("9 Oct 2026, 12:30 am");
    expect(dhakaDateISO(0, Date.parse("2026-10-08T18:30:00Z"))).toBe("2026-10-09");
  });

  it("describes relative time", () => {
    const now = Date.parse("2026-10-09T06:00:00Z");
    expect(formatRelative("2026-10-09T05:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-10-09T05:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-10-08T06:00:00Z", now)).toBe("yesterday");
  });

  it("never shows raw enum values", () => {
    expect(label("BKASH")).toBe("bKash");
    expect(label("READY_FOR_SHIPMENT")).toBe("Ready to ship");
    expect(label("SOMETHING_NEW")).toBe("Something new");
    expect(actionLabel("sale.created")).toBe("Sale created");
    expect(formatPercent(0.856)).toBe("86%");
    expect(formatPercent(null)).toBe("—");
    expect(initials("Abrar Rahman")).toBe("AR");
  });
});
