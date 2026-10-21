/**
 * "An order sheet on this lead was replaced on the server" - so a screen that holds its own copy of the lead (the Lead Center
 * keeps it in `useState`, not in the `['lead', id]` query) can re-read it. Without this the Job docs row keeps the OLD
 * `filePath` until the lead is reopened, and the eye opens the un-annotated sheet.
 */
type Listener = (leadId: string) => void;

const listeners = new Set<Listener>();

export const onOrderSheetChanged = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const emitOrderSheetChanged = (leadId: string): void => {
  listeners.forEach((fn) => {
    try {
      fn(leadId);
    } catch {
      /* a listener must not break the save */
    }
  });
};
