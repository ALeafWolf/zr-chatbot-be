export const TURN_ROUTES = [
  "roleplay_turn",
  "app_command",
  "unsupported",
] as const;

export type TurnRoute = (typeof TURN_ROUTES)[number];

export const ROLEPLAY_TURN_ROUTE: TurnRoute = "roleplay_turn";
export const APP_COMMAND_ROUTE: TurnRoute = "app_command";
export const UNSUPPORTED_ROUTE: TurnRoute = "unsupported";

export function isTurnRoute(value: unknown): value is TurnRoute {
  return (
    typeof value === "string" &&
    (TURN_ROUTES as readonly string[]).includes(value)
  );
}

export function persistedRouteForRoleplayResult(input: {
  wasDeflected: boolean;
}): TurnRoute {
  return input.wasDeflected ? UNSUPPORTED_ROUTE : ROLEPLAY_TURN_ROUTE;
}
