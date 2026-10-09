export interface AttributeInput {
  name: string;
  /** Comma-separated values as typed, e.g. "Black, White". */
  values: string;
}

export interface VariantDraft {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  attributes: Record<string, string>;
}

const skuPart = (value: string) => value.trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "").slice(0, 6);

export function parseValues(values: string) {
  return [...new Set(values.split(",").map((value) => value.trim()).filter(Boolean))];
}

/**
 * Color: Black, White × Size: M, L → 4 variants with suggested SKUs (plan §17). Existing edits are
 * kept when the combination still exists, so regenerating never loses typed barcodes or prices.
 */
export function generateVariants(
  baseSku: string,
  attributes: AttributeInput[],
  defaults: { price: string; cost: string },
  previous: VariantDraft[] = [],
): VariantDraft[] {
  const axes = attributes
    .map((attribute) => ({ name: attribute.name.trim(), values: parseValues(attribute.values) }))
    .filter((axis) => axis.name && axis.values.length);
  const base = skuPart(baseSku) || "SKU";
  if (!axes.length) {
    const existing = previous.find((draft) => draft.key === "default");
    return [existing ?? { key: "default", name: "Default", sku: `${base}-1`, barcode: "", price: defaults.price, cost: defaults.cost, attributes: {} }];
  }
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) {
    combos = combos.flatMap((combo) => axis.values.map((value) => ({ ...combo, [axis.name]: value })));
  }
  return combos.map((combo) => {
    const key = axes.map((axis) => `${axis.name}=${combo[axis.name]}`).join("|");
    const existing = previous.find((draft) => draft.key === key);
    if (existing) return existing;
    const values = axes.map((axis) => combo[axis.name]);
    return {
      key,
      name: values.join(" / "),
      sku: [base, ...values.map(skuPart)].join("-"),
      barcode: "",
      price: defaults.price,
      cost: defaults.cost,
      attributes: combo,
    };
  });
}
