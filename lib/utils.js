const _ = require('lodash');
const gtfs = require('gtfs');
const sanitize = require('sanitize-filename');
const moment = require('moment');

const { version } = require('../package.json');
const fileUtils = require('./file-utils');
const formatters = require('./formatters');

/*
 * Calculate the distance between two coordinates.
 */
function calculateDistanceMi(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const radlat1 = Math.PI * lat1 / 180;
  const radlat2 = Math.PI * lat2 / 180;
  const theta = lon1 - lon2;
  const radtheta = Math.PI * theta / 180;
  let dist = (Math.sin(radlat1) * Math.sin(radlat2)) + (Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta));
  if (dist > 1) {
    dist = 1;
  }

  dist = Math.acos(dist);
  dist = dist * 180 / Math.PI;
  dist = dist * 60 * 1.1515;
  return dist;
}

/*
 * Get a formatted list of stops for a trip from stoptimes
 */
const geStopsFromStoptimes = (stoptimes, stations) => {
  return stoptimes.reduce((memo, stoptime) => {
    const station = stations.find(station => station.stop_id === stoptime.stop_id);
    if (stoptime.arrival_time === stoptime.departure_time) {
      memo.push({
        station,
        time: stoptime.arrival_time,
        type: 'stop'
      });
    } else {
      memo.push(
        {
          station,
          time: stoptime.arrival_time,
          type: 'arrival'
        }, {
          station,
          time: stoptime.departure_time,
          type: 'departure'
        }
      );
    }

    return memo;
  }, []);
};

/*
 * Reverse the distances between stations for opposite trip direction
 */
const reverseStationDistances = (stations, oppositeDirectionDistance) => {
  const tripDistance = _.max(_.map(stations, 'distance'));
  for (const station of stations) {
    // Scale distances to match opposite direction total distance
    station.distance = (tripDistance - station.distance) * oppositeDirectionDistance / tripDistance;
  }
};

/*
 * Find longest trip
 */
const findLongestTrip = trips => _.maxBy(trips, trip => _.size(trip.stoptimes));

/*
 * Determine if a stoptime is a timepoint.
 */
const isTimepoint = stoptime => {
  if (stoptime.timepoint === undefined) {
    return stoptime.arrival_time !== '' && stoptime.departure_time !== '';
  }

  return stoptime.timepoint === 1;
};

const getStationsFromTrip = (trip, agencyKey) => {
  let previousStationCoordinates;
  return Promise.all(trip.stoptimes.map(async (stoptime, index) => {
    const stops = await gtfs.getStops({
      agency_key: agencyKey,
      stop_id: stoptime.stop_id
    });

    if (!stops || stops.length === 0) {
      throw new Error(`Unable to find stop id ${stoptime.stop_id}`);
    }

    const stop = stops[0];
    const hasShapeDistance = _.every(trip.stoptimes, stoptime => stoptime.shape_dist_traveled !== undefined);

    if (!hasShapeDistance) {
      if (index === 0) {
        stoptime.shape_dist_traveled = 0;
      } else {
        const previousStopTime = trip.stoptimes[index - 1];
        const distanceFromPreviousStation = calculateDistanceMi(stop.stop_lat, stop.stop_lon, previousStationCoordinates.stop_lat, previousStationCoordinates.stop_lon);
        stoptime.shape_dist_traveled = previousStopTime.shape_dist_traveled + distanceFromPreviousStation;
      }

      previousStationCoordinates = {
        stop_lat: stop.stop_lat,
        stop_lon: stop.stop_lon
      };
    }

    return {
      stop_id: stop.stop_id,
      name: stop.stop_name,
      distance: stoptime.shape_dist_traveled,
      direction_id: trip.direction_id
    };
  }));
};

/*
 * Get all trips and stoptimes for a given route
 */
const getDataforChart = async (agencyKey, routeId, date) => {
  const notes = [];
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

  if (!trips || trips.length === 0) {
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
      shape_dist_traveled: 1,
      timepoint: 1
    });

    trip.stoptimes = stoptimes.filter(stoptime => isTimepoint(stoptime));
  }));

  const longestTrip = findLongestTrip(trips);
  let stations = await getStationsFromTrip(longestTrip, agencyKey);
  const tripDistance = _.max(_.map(stations, 'distance'));
  const directionGroups = _.groupBy(trips, 'direction_id');

  // If there are two directions, get stops in other direction
  if (_.size(directionGroups) > 1) {
    const oppositeDirection = longestTrip.direction_id === 1 ? '0' : '1';
    const longestTripOppositeDirection = findLongestTrip(directionGroups[oppositeDirection]);
    const stationsOppositeDirection = await getStationsFromTrip(longestTripOppositeDirection, agencyKey);

    reverseStationDistances(stationsOppositeDirection, tripDistance);

    stations = [...stations, ...stationsOppositeDirection];
  }

  const formattedTrips = trips.map(trip => ({
    number: trip.trip_id,
    direction: trip.direction_id,
    trip_headsign: trip.trip_headsign,
    stops: geStopsFromStoptimes(trip.stoptimes, stations)
  }));

  const stops = formattedTrips.flatMap(trip => trip.stops.map(stop => ({
    trip,
    stop
  })));

  const hasShapeDistance = _.every(longestTrip.stoptimes, stoptime => stoptime.shape_dist_traveled !== undefined);
  if (!hasShapeDistance) {
    notes.push('Distance between stops calculated assuming a straight line.');
  }

  return {
    trips: formattedTrips,
    stops,
    stations,
    notes
  };
};

/*
 * Initialize configuration with defaults.
 */
exports.setDefaultConfig = initialConfig => {
  const defaults = {
    beautify: false,
    gtfsToChartVersion: version,
    chartDate: moment().format('YYYYMMDD'),
    skipImport: false
  };

  return { ...defaults, ...initialConfig };
};

/*
 * Generate the HTML for the agency overview page.
 */
exports.generateOverviewHTML = async (agencyKey, routes, config) => {
  const agencies = await gtfs.getAgencies({ agency_key: agencyKey });
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
    routes: _.sortBy(routes, r => Number.parseInt(r.route_short_name, 10))
  };
  return fileUtils.renderFile('overview_page', templateVars, config);
};

/*
 * Generate the HTML for a chart.
 */
exports.generateChartHTML = async (routeId, agencyKey, date, config) => {
  const routes = await gtfs.getRoutes({
    agency_key: agencyKey,
    route_id: routeId
  });

  if (!routes || routes.length === 0) {
    throw new Error('Invalid route id provided');
  }

  const chartData = await getDataforChart(agencyKey, routeId, date);

  return fileUtils.renderFile('chart_page', {
    route: routes[0],
    chartData,
    config
  }, config);
};
