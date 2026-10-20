/**
 * What an agreement drawn on the device (offline, or a lead created at a door) needs on disk, and when it must refuse to
 * draw one. Pure, so the rules are testable.
 *
 * The Description of Work comes from CONFIG, not code: `GET /sales-rep/v1/description-schema/:productId` carries the line
 * templates (including `[IF ..]` blocks and `col:` grid-column refs - see `description-schema-evaluator.ts`) and
 * `GET /sales-rep/v1/agreement-config` carries the layout. The device evaluates them itself, so offline it can only be as
 * good as the copy it saved while it still had signal.
 */

/** The product ids whose description schema an agreement may ask for: `vertical.productId || vertical.id`, as `VerticalSummaryTab` does. */
export const agreementProductIds = (verticals: any[] | null | undefined): string[] => {
  const seen = new Set<string>();
  (Array.isArray(verticals) ? verticals : []).forEach((v) => {
    const id = v?.productId || v?.id;
    if (id !== undefined && id !== null && String(id).trim() !== '') seen.add(String(id).trim());
  });
  return [...seen];
};

/**
 * True when a locally drawn agreement would carry NO real Description of Work only because the schema was never saved on
 * this device (the fetch failed and nothing was cached). An empty scope from a product that simply has no schema
 * configured is NOT this case - that query succeeds with `null`.
 *
 * ⚠️ Without this the dialog quietly fell back to the generic line "Project completion per summary details" on a
 * document the customer then signs.
 */
export const descriptionSchemaMissingOffline = (input: {
  renderLocally: boolean;
  schemaLoading: boolean;
  schema: unknown;
  schemaError: unknown;
  hasProvidedScope: boolean;
}): boolean =>
  input.renderLocally && !input.schemaLoading && !input.schema && !!input.schemaError && !input.hasProvidedScope;
