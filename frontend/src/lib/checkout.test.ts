import { discountAmount, evaluateTender, paymentPayload, quickCashOptions, subtotalOf } from "./checkout";

describe("checkout arithmetic", () => {
  it("adds line totals without floating-point drift", () => {
    expect(subtotalOf([{ price: "0.10", quantity: 3 }, { price: "2490.00", quantity: 2 }])).toBe(4980.3);
  });

  it("caps discounts at the subtotal and supports percentages", () => {
    expect(discountAmount(2000, "250", "amount")).toBe(250);
    expect(discountAmount(2000, "5000", "amount")).toBe(2000);
    expect(discountAmount(2490, "10", "percent")).toBe(249);
    expect(discountAmount(2000, "-5", "amount")).toBe(0);
  });

  it("suggests the exact amount and the next round notes", () => {
    expect(quickCashOptions(1290)).toEqual([1290, 1300, 1500, 2000]);
    expect(quickCashOptions(500)).toEqual([500, 1000]);
  });

  it("gives change only on cash and blocks underpayment", () => {
    expect(evaluateTender(1290, "CASH", "1500", [])).toEqual({ received: 1500, change: 210, problem: null });
    expect(evaluateTender(1290, "CASH", "", [])).toEqual({ received: 1290, change: 0, problem: null });
    expect(evaluateTender(1290, "CASH", "1000", []).problem).toBe("৳290 still to pay");
    expect(evaluateTender(1290, "BKASH", "1500", []).problem).toMatch(/match the total/);
  });

  it("validates split payments the way the server does", () => {
    const splits = [{ method: "BKASH" as const, amount: "1500" }, { method: "CASH" as const, amount: "1000" }];
    const tender = evaluateTender(2000, "SPLIT", "", splits);

    expect(tender).toEqual({ received: 2500, change: 500, problem: null });
    expect(paymentPayload("SPLIT", tender, splits)).toEqual({
      payment_method: "SPLIT",
      amount_received: 2500,
      payments: [{ method: "BKASH", amount: "1500.00" }, { method: "CASH", amount: "1000.00" }],
    });
    expect(evaluateTender(2000, "SPLIT", "", [{ method: "CARD", amount: "2500" }, { method: "CASH", amount: "100" }]).problem).toMatch(/cannot exceed/);
    expect(evaluateTender(2000, "SPLIT", "", [{ method: "CASH", amount: "2000" }]).problem).toBe("Add at least two payment lines");
  });
});
