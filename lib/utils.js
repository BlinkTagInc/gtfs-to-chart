import path from 'node:path';
import { readFileSync } from 'node:fs';

import {
  max,
  map,
  maxBy,
  size,
  every,
  uniq,
  groupBy,
  first,
  sortBy,
} from 'lodash-es';
import { getStops, openDb, getStoptimes, getAgencies, getRoutes } from 'gtfs';
import sanitize from 'sanitize-filename';
import moment from 'moment';
import sqlString from 'sqlstring';

import { renderTemplate } from './file-utils.js';
import { formatRouteName } from './formatters.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
);

/*
 * Convert a GTFS formatted time string into a moment less than 24 hours.
 */
export function fromGTFSTime(timeString) {
  const duration = moment.duration(timeString);

  return moment({
    hour: duration.hours(),
    minute: duration.minutes(),
    second: duration.seconds(),
  });
}

/*
 * Convert a moment into a GTFS formatted time string.
 */
export function toGTFSTime(time) {
  return time.format('HH:mm:ss');
}

/*
 * Calculate the distance between two coordinates.
 */
function calculateDistanceMi(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const radlat1 = (Math.PI * lat1) / 180;
  const radlat2 = (Math.PI * lat2) / 180;
  const theta = lon1 - lon2;
  const radtheta = (Math.PI * theta) / 180;
  let dist =
    Math.sin(radlat1) * Math.sin(radlat2) +
    Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
  if (dist > 1) {
    dist = 1;
  }

  dist = Math.acos(dist);
  dist = (dist * 180) / Math.PI;
  dist = dist * 60 * 1.1515;
  return dist;
}

/*
 * Reverse the distances between stations for opposite trip direction
 */
const reverseStationDistances = (stations, oppositeDirectionDistance) => {
  const tripDistance = max(map(stations, 'distance'));
  for (const station of stations) {
    // Scale distances to match opposite direction total distance
    station.distance =
      ((tripDistance - station.distance) * oppositeDirectionDistance) /
      tripDistance;
  }
};

/*
 * Find longest trip
 */
const findLongestTrip = (trips) => maxBy(trips, (trip) => size(trip.stoptimes));

/*
 * Determine if a stoptime is a timepoint.
 */
const isTimepoint = (stoptime) => {
  if (stoptime.timepoint === null) {
    return stoptime.arrival_time !== '' && stoptime.departure_time !== '';
  }

  return stoptime.timepoint === 1;
};

const getStationsFromTrip = (trip) => {
  const stops = trip.stoptimes.map((stoptime) => {
    const stops = getStops({
      stop_id: stoptime.stop_id,
    });

    if (stops.length === 0) {
      throw new Error(`Unable to find stop id ${stoptime.stop_id}`);
    }

    return stops[0];
  });

  let previousStationCoordinates;
  return trip.stoptimes.map((stoptime, index) => {
    const stop = stops[index];
    const hasShapeDistance = every(
      trip.stoptimes,
      (stoptime) => stoptime.shape_dist_traveled !== null,
    );

    if (!hasShapeDistance) {
      if (index === 0) {
        stoptime.shape_dist_traveled = 0;
      } else {
        const previousStopTime = trip.stoptimes[index - 1];
        const distanceFromPreviousStation = calculateDistanceMi(
          stop.stop_lat,
          stop.stop_lon,
          previousStationCoordinates.stop_lat,
          previousStationCoordinates.stop_lon,
        );
        stoptime.shape_dist_traveled =
          previousStopTime.shape_dist_traveled + distanceFromPreviousStation;
      }

      previousStationCoordinates = {
        stop_lat: stop.stop_lat,
        stop_lon: stop.stop_lon,
      };
    }

    return {
      stop_id: stop.stop_id,
      name: stop.stop_name,
      distance: stoptime.shape_dist_traveled,
      direction_id: trip.direction_id,
    };
  });
};

/*
 * Get all trips and stoptimes for a given route
 */
const getDataforChart = (config, routeId) => {
  const db = openDb(config);
  const notes = [];
  const dayOfWeek = moment(config.chartDate, 'YYYYMMDD')
    .format('dddd')
    .toLowerCase();
  const calendars = db
    .prepare(
      `SELECT DISTINCT service_id FROM calendar WHERE start_date <= $date AND end_date >= $date AND ${sqlString.escapeId(dayOfWeek)} = 1`,
    )
    .all({ date: config.chartDate });

  if (calendars.length === 0) {
    throw new Error(
      `No calendars found for route ${routeId} on ${moment(config.chartDate, 'YYYYMMDD').format('MMM D, YYYY')}. Try changing the chartDate in your config.json file to a date that has service.`,
    );
  }

  const serviceIds = calendars.map((calendar) => calendar.service_id);
  let trips = db
    .prepare(
      `SELECT service_id, trip_id, trip_headsign, direction_id, shape_id FROM trips where route_id = ? AND service_id IN (${serviceIds.map(() => '?').join(', ')})`,
    )
    .all(routeId, ...serviceIds);

  if (trips.length === 0) {
    throw new Error(
      `No trips found for route ${routeId} on ${moment(config.chartDate, 'YYYYMMDD').format('MMM D, YYYY')}`,
    );
  }

  const shapeIds = uniq(map(trips, 'shape_id'));

  if (shapeIds.length === 0) {
    throw new Error('Route has no shapes.');
  }

  for (const trip of trips) {
    const stoptimes = getStoptimes(
      {
        trip_id: trip.trip_id,
      },
      [
        'arrival_time',
        'departure_time',
        'stop_id',
        'shape_dist_traveled',
        'timepoint',
      ],
      [['stop_sequence', 'ASC']],
    );

    trip.stoptimes = stoptimes.filter((stoptime) => isTimepoint(stoptime));
  }

  const frequencies = db
    .prepare(
      `SELECT * FROM frequencies WHERE trip_id IN (${trips.map((trip) => '?').join(', ')})`,
    )
    .all(...trips.map((trip) => trip.trip_id));

  // Create trips from frequencies.txt
  if (frequencies.length > 0) {
    for (const frequency of frequencies) {
      const exampleTrip = trips.find(
        (trip) => trip.trip_id === frequency.trip_id,
      );
      if (!exampleTrip) {
        console.log(`No example trip found for frequency ${frequency.trip_id}`);
        continue;
      }

      const stoptimesOffsets = exampleTrip.stoptimes.map((stoptime, index) => ({
        departure_offset: fromGTFSTime(stoptime.departure_time).diff(
          fromGTFSTime(exampleTrip.stoptimes[0].departure_time),
          'seconds',
        ),
        arrival_offset: fromGTFSTime(stoptime.arrival_time).diff(
          fromGTFSTime(exampleTrip.stoptimes[0].arrival_time),
          'seconds',
        ),
      }));

      for (
        let offset = 0;
        fromGTFSTime(frequency.start_time)
          .add(offset, 'seconds')
          .isBefore(fromGTFSTime(frequency.end_time));
        offset += frequency.headway_secs
      ) {
        trips.push({
          ...exampleTrip,
          trip_id: `${exampleTrip.trip_id}_${toGTFSTime(fromGTFSTime(frequency.start_time).add(offset, 'seconds'))}`,
          stoptimes: exampleTrip.stoptimes.map((stoptime, index) => ({
            ...stoptime,
            arrival_time: toGTFSTime(
              fromGTFSTime(frequency.start_time)
                .add(offset, 'seconds')
                .add(stoptimesOffsets[index].arrival_offset, 'seconds'),
            ),
            departure_time: toGTFSTime(
              fromGTFSTime(frequency.start_time)
                .add(offset, 'seconds')
                .add(stoptimesOffsets[index].departure_offset, 'seconds'),
            ),
          })),
        });
      }
    }

    // Remove the example trips from the trips array
    trips = trips.filter(
      (trip) =>
        !frequencies.some((frequency) => frequency.trip_id === trip.trip_id),
    );
  }

  const longestTrip = findLongestTrip(trips);
  let stations = getStationsFromTrip(longestTrip);
  const tripDistance = max(map(stations, 'distance'));
  const directionGroups = groupBy(trips, 'direction_id');

  // If there are two directions, get stops in other direction
  if (size(directionGroups) > 1) {
    const oppositeDirection = longestTrip.direction_id === 1 ? '0' : '1';
    const longestTripOppositeDirection = findLongestTrip(
      directionGroups[oppositeDirection],
    );
    const stationsOppositeDirection = getStationsFromTrip(
      longestTripOppositeDirection,
    );

    reverseStationDistances(stationsOppositeDirection, tripDistance);

    stations = [...stations, ...stationsOppositeDirection];
  }

  const hasShapeDistance = every(
    longestTrip.stoptimes,
    (stoptime) => stoptime.shape_dist_traveled !== null,
  );
  if (!hasShapeDistance) {
    notes.push('Distance between stops calculated assuming a straight line.');
  }

  return {
    trips,
    stations,
    notes,
  };
};

/*
 * Initialize configuration with defaults.
 */
export function setDefaultConfig(initialConfig) {
  const defaults = {
    beautify: false,
    gtfsToChartVersion: version,
    chartDate: moment().format('YYYYMMDD'),
    skipImport: false,
  };

  return { ...defaults, ...initialConfig };
}

/*
 * Generate the HTML for the agency overview page.
 */
export async function generateOverviewHTML(config, routes) {
  const agencies = getAgencies();
  if (agencies.length === 0) {
    throw new Error('No agencies found');
  }

  const agency = first(agencies);

  for (const route of routes) {
    route.relativePath = config.isLocal
      ? path.join('charts', sanitize(route.route_id))
      : path.join('charts', sanitize(`${formatRouteName(route)}.html`));
  }

  const templateVars = {
    agency,
    config,
    routes: sortBy(routes, (r) => Number.parseInt(r.route_short_name, 10)),
  };
  return renderTemplate('overview_page', templateVars, config);
}

/*
 * Generate the HTML for a chart.
 */
export async function generateChartHTML(config, routeId) {
  const routes = getRoutes({
    route_id: routeId,
  });

  if (routes.length === 0) {
    throw new Error('Invalid route id provided');
  }

  const chartData = getDataforChart(config, routeId);

  return renderTemplate(
    'chart_page',
    {
      route: routes[0],
      chartData,
      config,
      moment,
    },
    config,
  );
}
