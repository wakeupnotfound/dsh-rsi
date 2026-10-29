import { applyComponent } from "../../index.js";
export const name = "dsh-rsi-verifier";
export function apply(ctx, config) {
  return applyComponent(ctx, config, "verifier");
}
