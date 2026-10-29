import { applyComponent } from "../../index.js";
export const name = "dsh-rsi-memory";
export function apply(ctx, config) {
  return applyComponent(ctx, config, "memory");
}
