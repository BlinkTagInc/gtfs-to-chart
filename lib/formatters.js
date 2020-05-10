const _ = require('lodash');
const moment = require('moment');

/* 
 * Format a route name.
 */
exports.formatRouteName = route => {
  if (route.route_short_name !== '' && route.route_short_name !== undefined) {
    return route.route_short_name;
  }
  
  return route.route_long_name;
}
