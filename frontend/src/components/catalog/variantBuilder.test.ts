import { generateVariants, parseValues } from "./variantBuilder";

describe("variant builder", () => {
  it("generates every combination with suggested SKUs", () => {
    const variants = generateVariants(
      "pan",
      [{ name: "Color", values: "Black, White" }, { name: "Size", values: "M, L, xl" }],
      { price: "1500", cost: "800" },
    );

    expect(variants).toHaveLength(6);
    expect(variants[0]).toMatchObject({ name: "Black / M", sku: "PAN-BLACK-M", price: "1500", attributes: { Color: "Black", Size: "M" } });
    expect(variants.at(-1)?.sku).toBe("PAN-WHITE-XL");
  });

  it("keeps edits when regenerating", () => {
    const first = generateVariants("TEE", [{ name: "Size", values: "M" }], { price: "500", cost: "0" });
    const edited = [{ ...first[0], barcode: "8901", price: "550" }];

    const next = generateVariants("TEE", [{ name: "Size", values: "M, L" }], { price: "500", cost: "0" }, edited);

    expect(next[0]).toMatchObject({ barcode: "8901", price: "550" });
    expect(next[1]).toMatchObject({ name: "L", sku: "TEE-L", barcode: "" });
  });

  it("falls back to one default variant and de-duplicates values", () => {
    expect(generateVariants("cap", [], { price: "200", cost: "90" })).toEqual([
      { key: "default", name: "Default", sku: "CAP-1", barcode: "", price: "200", cost: "90", attributes: {} },
    ]);
    expect(parseValues("M, m , M, L,")).toEqual(["M", "m", "L"]);
  });
});
