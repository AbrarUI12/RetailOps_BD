import axe from "axe-core";

/** Fails the test with readable messages when axe finds accessibility violations. */
export async function expectNoAxeViolations(container: Element) {
  const results = await axe.run(container, {
    // jsdom cannot compute colors; contrast is checked against the design tokens instead.
    rules: { "color-contrast": { enabled: false } },
  });
  const messages = results.violations.map(
    (violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
  expect(messages).toEqual([]);
}
