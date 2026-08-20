import type { Sigma } from "sigma";

// Sigma v4 has no public getNodeAtPosition — the event system handles
// hit-testing internally. This no-op shim preserves the call site in
// GraphController without patching private internals.
export function dedupeNodeHitTest(_sigma: Sigma): void {}
