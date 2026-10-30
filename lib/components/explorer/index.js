import { applyComponent } from "../../index.js";
export const name = "dsh-rsi-explorer";
export function apply(ctx, config) {
  return applyComponent(ctx, config, "explorer");
}
