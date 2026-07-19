import type { AppSnapshot, PlanDefinition } from "./catalog";

export type DiscoveredPlanDefinition = PlanDefinition & { discovered?: boolean };

export function discoverPlans(app: AppSnapshot, curatedPlans?: PlanDefinition[]): DiscoveredPlanDefinition[];
export function uncoveredItems(app: AppSnapshot, plans: PlanDefinition[]): Array<{ name: string; occurrence: number }>;
