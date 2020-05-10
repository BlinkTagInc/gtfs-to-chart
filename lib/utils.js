const _ = require('lodash');
const gtfs = require('gtfs');
const sanitize = require('sanitize-filename');
const moment = require('moment');
const d3TimeFormat = require('d3-time-format');

const {version} = require('../package.json');
const fileUtils = require('./file-utils');
const formatters = require('./formatters');

/*
 * Determine if a stoptime is a timepoint.
 */
const isTimepoint = stoptime => {
  if (stoptime.timepoint === undefined) {
    return stoptime.arrival_time !== '' && stoptime.departure_time !== '';
  }

  return stoptime.timepoint === 1;
};

const parseTime = string => {
  const parseTime = d3TimeFormat.utcParse('%H:%M:%S');
  const date = parseTime(string);
  if (date !== null && date.getUTCHours() < 3) date.setUTCDate(date.getUTCDate() + 1);
  return date;
};

/*
 * Get all trips and stoptimes for a given route
 */
const getDataforDiagram = async (agencyKey, routeId, date) => {
  const calendarQuery = {
    agency_key: agencyKey,
    start_date: { $lte: date },
    end_date: { $gte: date }
  };

  const dayOfWeek = moment(date, 'YYYYMMDD').format('dddd').toLowerCase();
  calendarQuery[dayOfWeek] = 1;

  const calendars = await gtfs.getCalendars(calendarQuery);
  const serviceIds = _.uniq(_.map(calendars, 'service_id'));

  const trips = await gtfs.getTrips({
    agency_key: agencyKey,
    route_id: routeId,
    service_id: {
      $in: serviceIds
    }
  }, {
    _id: 0,
    service_id: 1,
    trip_id: 1,
    trip_headsign: 1,
    direction_id: 1,
    shape_id: 1
  });

  if (!trips || !trips.length) {
    throw new Error(`No trips found for route ${routeId} on ${moment(date, 'YYYYMMDD').format('MMM D, YYYY')}`);
  }

  const shapeIds = _.uniq(_.map(trips, 'shape_id'));

  if (!shapeIds || shapeIds.length === 0) {
    throw new Error('Route has no shapes.');
  }

  await Promise.all(trips.map(async trip => {
    const stoptimes = await gtfs.getStoptimes({
      agency_key: agencyKey,
      trip_id: trip.trip_id
    }, {
      _id: 0,
      arrival_time: 1,
      departure_time: 1,
      stop_id: 1,
      shape_dist_traveled: 1
    });

    trip.stoptimes = stoptimes.filter(isTimepoint);
  }));

  if (_.some(trips[0].stoptimes, stoptime => stoptime.shape_dist_traveled === undefined)) {
    throw new Error('No `shape_dist_traveled` present in stop_times.txt');
  }

  const directionGroups = _.groupBy(trips, 'direction_id');

  const diagramData = await Promise.all(Object.values(directionGroups).map(async directionTrips => {
    const longestTrip = _.maxBy(directionTrips, trip => _.size(trip.stoptimes));

    const stations = await Promise.all(longestTrip.stoptimes.map(async stoptime => {
      const stops = await gtfs.getStops({
        agency_key: agencyKey,
        stop_id: stoptime.stop_id
      });

      if (!stops || !stops.length) {
        throw new Error(`Unable to find stop id ${stoptime.stop_id}`);
      }

      const stop = stops[0];

      return {
        key: stop.stop_id,
        name: stop.stop_name,
        distance: stoptime.shape_dist_traveled  
      }
    }));

    const formattedTrips = directionTrips.map(trip => ({
      number: trip.trip_id,
      direction: trip.direction_id,
      trip_headsign: trip.trip_headsign,
      stops: trip.stoptimes.map(stoptime => ({
        station: stations.find(station => station.key === stoptime.stop_id),
        time: parseTime(stoptime.arrival_time)
      }))
    }))

    const stops = formattedTrips.flatMap(trip => trip.stops.map(stop => ({
      trip,
      stop
    })))

    return {
      trips: formattedTrips,
      stops,
      stations
    }
  }));
  

  return diagramData;
}

/*
 * Initialize configuration with defaults.
 */
exports.setDefaultConfig = initialConfig => {
  const defaults = {
    beautify: false,
    gtfsToDiagram: version,
    skipImport: false,
  };

  return {...defaults, ...initialConfig};
};

/*
 * Generate the HTML for the agency overview page.
 */
exports.generateOverviewHTML = async (agencyKey, routes, config) => {
  const agencies = await gtfs.getAgencies({agency_key: agencyKey});
  if (!agencies || agencies.length === 0) {
    throw new Error(`No agency found for agency_key=${agencyKey}`);
  }

  const agency = _.first(agencies);

  for (const route of routes) {
    const routeName = sanitize(formatters.formatRouteName(route));
    route.relativePath = routeName;
  }

  const templateVars = {
    agencyKey,
    agency,
    config,
    routes: _.sortBy(routes, r => parseInt(r.route_short_name, 10))
  };
  return fileUtils.renderFile('overview_page', templateVars, config);
};

/*
 * Generate the HTML for a diagram.
 */
exports.generateDiagramHTML = async (routeId, agencyKey, date, config) => {
  const routes = await gtfs.getRoutes({
    agency_key: agencyKey,
    route_id: routeId
  });

  if (!routes || !routes.length) {
    throw new Error('Invalid route id provided');
  }

  const diagramData = await getDataforDiagram(agencyKey, routeId, date);

  return fileUtils.renderFile('diagram_page', {
    route: routes[0],
    diagramData,
    config
  }, config);
}
