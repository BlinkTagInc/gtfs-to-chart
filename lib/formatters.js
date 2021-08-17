/*
 * Format a route name.
 */
export function formatRouteName(route) {
  if (route.route_short_name !== '' && route.route_short_name !== null) {
    return route.route_short_name;
  }

  return route.route_long_name;
}
