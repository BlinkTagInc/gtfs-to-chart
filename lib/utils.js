const _ = require('lodash');
const gtfs = require('gtfs');
const sanitize = require('sanitize-filename');

const {version} = require('../package.json');
const fileUtils = require('./file-utils');
const formatters = require('./formatters');
const timeUtils = require('./time-utils');

/*
 * Determine if a stoptime is a timepoint.
 */
const isTimepoint = stoptime => {
  if (stoptime.timepoint === undefined) {
    return stoptime.arrival_time !== '' && stoptime.departure_time !== '';
  }

  return stoptime.timepoint === 1;
};

/*
 * Find the longest trip (most stops) in a group of trips and return stoptimes.
 */
const getLongestTripStoptimes = (trips, config) => {
  let filteredTripStoptimes;

  // If `showOnlyTimepoint` is true, then filter out all non-timepoints
  if (config.showOnlyTimepoint === true) {
    filteredTripStoptimes = trips.map(trip => _.filter(trip.stoptimes, isTimepoint));
  } else {
    filteredTripStoptimes = trips.map(trip => trip.stoptimes);
  }

  return _.maxBy(filteredTripStoptimes, stoptimes => _.size(stoptimes));
};

/*
 * Find the first stop_id that all trips have in common, otherwise use the first
 * stoptime.
 */
const findCommonStopId = (trips, config) => {
  const longestTripStoptimes = getLongestTripStoptimes(trips, config);

  if (!longestTripStoptimes) {
    return null;
  }

  const commonStoptime = _.find(longestTripStoptimes, (stoptime, idx) => {
    // If longest trip is a loop (first and last stops the same), then skip first stoptime
    if (idx === 0 && stoptime.stop_id === _.last(longestTripStoptimes).stop_id) {
      return false;
    }

    // If stoptime isn't a timepoint, skip it
    if (stoptime.arrival_time === '') {
      return false;
    }

    return _.every(trips, trip => {
      return _.find(trip.stoptimes, {stop_id: stoptime.stop_id});
    });
  });

  return commonStoptime ? commonStoptime.stop_id : null;
};

/*
 * Return a set of unique trips (with at least one unique stop time) from an
 * array of trips.
 */
const deduplicateTrips = (trips, commonStopId) => {
  // Remove duplicate trips (from overlapping service_ids)
  const deduplicatedTrips = trips.reduce((memo, trip) => {
    if (memo.length === 0 || trip.stoptimes.length === 0) {
      memo.push(trip);
    } else {
      const stoptimes = _.map(trip.stoptimes, 'departure_time');

      let selectedStoptime;
      if (commonStopId) {
        selectedStoptime = _.find(trip.stoptimes, {stop_id: commonStopId});
      } else {
        selectedStoptime = trip.stoptimes[0];
      }

      // Find all other trips where the common stop has the same departure time
      const similarTrips = _.filter(memo, trip => {
        const stoptime = _.find(trip.stoptimes, {stop_id: selectedStoptime.stop_id});
        if (!stoptime) {
          return false;
        }

        return stoptime.departure_time === selectedStoptime.departure_time;
      });

      // Only add trip if no existing trip with the same set of timepoints has already been added
      const tripIsUnique = _.every(similarTrips, similarTrip => {
        const similarTripStoptimes = _.map(similarTrip.stoptimes, 'departure_time');
        return !_.isEqual(stoptimes, similarTripStoptimes);
      });

      if (tripIsUnique) {
        memo.push(trip);
      }
    }

    return memo;
  }, []);

  return deduplicatedTrips;
};

/*
 * Sort trips chronologically, using a common stop id if available, otherwise use the first stoptime.
 */
const sortTrips = (trips, config) => {
  let sortedTrips;
  let commonStopId;

  if (_.includes(['beginning', 'end'], config.sortingAlgorithm)) {
    sortedTrips = sortTripsByStartOrEnd(trips, config);
  } else {
    if (config.sortingAlgorithm === 'common') {
      commonStopId = findCommonStopId(trips, config);
    }

    sortedTrips = _.sortBy(trips, trip => {
      if (trip.stoptimes.length === 0) {
        return;
      }

      let selectedStoptime;
      if (commonStopId) {
        selectedStoptime = _.find(trip.stoptimes, {stop_id: commonStopId});
      } else if (config.sortingAlgorithm === 'last') {
        selectedStoptime = _.last(trip.stoptimes);
      } else {
        selectedStoptime = _.first(trip.stoptimes);
      }

      return formatters.timeToSeconds(selectedStoptime.departure_time);
    });
  }

  return deduplicateTrips(sortedTrips, commonStopId);
};

/*
 * Sort trips chronologically, using a common stop id if available, otherwise use the first stoptime.
 */
const sortTripsByStartOrEnd = (trips, config) => {
  let referenceStoptimes;
  let sortingDirection;
  let sortingOrder;
  let sortedTrips = trips;

  if (config.sortingAlgorithm === 'end') {
    referenceStoptimes = _.orderBy(getLongestTripStoptimes(trips, config), ['stop_sequence'], 'desc');
    sortingDirection = -1;
    sortingOrder = 'desc';
  } else {
    referenceStoptimes = _.sortBy(getLongestTripStoptimes(trips, config), ['stop_sequence']);
    sortingDirection = 1;
    sortingOrder = 'asc';
  }

  for (const stop of referenceStoptimes) {
    let previousSortingStoptime;
    for (const trip of sortedTrips) {
      if (trip.stoptimes.length === 0) {
        trip.sortingStoptime = undefined;
      }

      const selectedStoptime = _.find(trip.stoptimes, {stop_id: stop.stop_id});

      if (!selectedStoptime) {
        if (!trip.sortingStoptime || trip.sortingStoptime * sortingDirection < previousSortingStoptime * sortingDirection) {
          trip.sortingStoptime = previousSortingStoptime;
        }
      } else if (isTimepoint(selectedStoptime)) {
        trip.sortingStoptime = formatters.timeToSeconds(selectedStoptime.departure_time);
      } else if (!trip.sortingStoptime || trip.sortingStoptime * sortingDirection < previousSortingStoptime * sortingDirection) {
        trip.sortingStoptime = previousSortingStoptime;
      }

      if (selectedStoptime) {
        selectedStoptime.sortingTime = trip.sortingStoptime;
      }

      previousSortingStoptime = trip.sortingStoptime;
    }

    sortedTrips = _.orderBy(sortedTrips, ['sortingStoptime'], sortingOrder);
  }

  if (sortingOrder === 'desc') {
    return sortedTrips.reverse();
  }

  return sortedTrips;
};

/*
 * Get the trip_headsign for a specific timetable.
 */
const getDirectionHeadsignFromTimetable = async timetable => {
  const directions = await gtfs.getDirectionsByRoute({
    agency_key: timetable.agency_key,
    route_id: timetable.route_id,
    direction_id: timetable.direction_id
  });

  if (directions.length === 0) {
    return '';
  }

  return _.first(directions).trip_headsign;
};

/*
 * Get an array of stop_ids for a specific timetable.
 */
const getStopIds = async (timetable, config) => {
  const timetableStopOrders = await gtfs.getTimetableStopOrders({
    agency_key: timetable.agency_key,
    timetable_id: timetable.timetable_id
  });

  if (timetableStopOrders && timetableStopOrders.length !== 0) {
    // Use the stop_sequence from `timetable_stop_order.txt`
    return _.map(timetableStopOrders, 'stop_id');
  }

  let stopIds = [];
  const longestTripStoptimes = getLongestTripStoptimes(timetable.orderedTrips, config);

  for (const stoptime of longestTripStoptimes) {
    stopIds[stoptime.stop_sequence] = stoptime.stop_id;
  }

  // Remove any missing values from missing stop_sequence
  stopIds = _.compact(stopIds);

  /*
    * Check if any stoptimes have different arrival and departure times and
    * if they do, duplicate the stop id unless it is the first or last stop.
    * Edited by Pawajoro - minimal difference specified in config, or NULL
  */
  for (const trip of timetable.orderedTrips) {
    for (const stoptime of trip.stoptimes) {
      const timepointDifference = timeUtils.fromGTFSTime(stoptime.departure_time).diff(timeUtils.fromGTFSTime(stoptime.arrival_time), 'minutes');
      if (config.showArrivalOnDifference !== null && timepointDifference >= config.showArrivalOnDifference) {
        const index = stopIds.indexOf(stoptime.stop_id);
        if (index === 0 || index === stopIds.length - 1) {
          continue;
        }

        if (stopIds[index] === stopIds[index + 1] || stopIds[index] === stopIds[index - 1]) {
          continue;
        }

        stopIds.splice(index, 0, stoptime.stop_id);
      }
    }
  }

  return stopIds;
};

/*
 * Get an array of stops for a specific timetable.
 */
const getStops = async (timetable, config) => {
  if (timetable.orderedTrips.length === 0) {
    return [];
  }

  const stopIds = await getStopIds(timetable, config);

  // Convert stops to array of objects
  const stops = await Promise.all(stopIds.map(async (stopId, idx) => {
    const stopQuery = {
      agency_key: timetable.agency_key,
      stop_id: stopId
    };

    const stops = await gtfs.getStops(stopQuery, undefined, {limit: 1, lean: true});

    if (stops.length === 0) {
      config.logWarning(`No stop found for agency_key=${timetable.agency_key}, stop_id=${stopId}`);
      return null;
    }

    const stop = _.first(stops);
    stop.trips = [];

    if (idx < (stopIds.length - 1) && stopId === stopIds[idx + 1]) {
      stop.type = 'arrival';
    } else if (idx > 0 && stopId === stopIds[idx - 1]) {
      stop.type = 'departure';
    }

    // If `showStopCity` is true, look up stop attributes.
    if (timetable.showStopCity) {
      const stopAttribute = await gtfs.getStopAttributes(stopQuery);
      if (stopAttribute.length > 0) {
        stop.stop_city = _.first(stopAttribute).stop_city;
      }
    }

    return stop;
  }));

  const formattedStops = formatters.formatStops(_.compact(stops), timetable, config);
  return formattedStops;
};

/*
 * Get all calendars from a specific timetable.
 */
const getCalendarsFromTimetable = async timetable => {
  const calendarQuery = {
    agency_key: timetable.agency_key
  };

  if (timetable.end_date) {
    calendarQuery.start_date = {$lt: timetable.end_date};
  }

  if (timetable.start_date) {
    calendarQuery.end_date = {$gte: timetable.start_date};
  }

  const days = getDaysFromCalendars([timetable]);
  // Create an $or query array of days based on calendars
  const dayQuery = _.reduce(days, (memo, value, key) => {
    if (value === 1) {
      const queryItem = {};
      queryItem[key] = value;
      memo.push(queryItem);
    }

    return memo;
  }, []);

  if (dayQuery.length > 0) {
    calendarQuery.$or = dayQuery;
  }

  return gtfs.getCalendars(calendarQuery);
};

/*
 * Get all calendar date service ids for an agency between two dates.
 */
const getCalendarDatesServiceIds = async (agencyKey, startDate, endDate) => {
  const calendarDateQuery = {
    agency_key: agencyKey,
    exception_type: 1
  };

  if (endDate) {
    if (!calendarDateQuery.date) {
      calendarDateQuery.date = {};
    }

    calendarDateQuery.date.$lt = endDate;
  }

  if (startDate) {
    if (!calendarDateQuery.date) {
      calendarDateQuery.date = {};
    }

    calendarDateQuery.date.$gte = startDate;
  }

  const calendarDates = await gtfs.getCalendarDates(calendarDateQuery);

  return _.map(calendarDates, 'service_id');
};

/*
 * Get formatted freuqencies for a specific trip.
 */
const getFrequenciesByTrip = async trip => {
  const frequencies = await gtfs.getFrequencies({
    agency_key: trip.agency_key,
    trip_id: trip.trip_id
  });
  return frequencies.map(formatters.formatFrequency);
};

/*
 * Get all stoptimes for a trip.
 */
const getStoptimesByTrip = async trip => {
  return gtfs.getStoptimes({
    agency_key: trip.agency_key,
    trip_id: trip.trip_id
  });
};

/*
 * For a specific stop_id, returms an array all stop_ids within a parent station
 * and the stop_id of parent station itself. If no parent station, it returns the
 * stop_id.
 */
const getAllStationStopIds = async (stopId, agencyKey) => {
  const stop = await gtfs.getStops({
    agency_key: agencyKey,
    stop_id: stopId
  });

  if (stop[0].parent_station === '' || stop[0].parent_station === undefined) {
    return [stopId];
  }

  const stopsInParentStation = await gtfs.getStops({
    parent_station: stop[0].parent_station
  }, {stop_id: 1});

  return [stop[0].parent_station, ..._.map(stopsInParentStation, 'stop_id')];
};

/*
 * Get trips with the same blockId
 */
const getTripsWithSameBlock = async (trip, timetable) => {
  const tripQuery = {
    agency_key: trip.agency_key,
    block_id: trip.block_id,
    service_id: {
      $in: timetable.serviceIds
    }
  };

  const trips = await gtfs.getTrips(tripQuery, {trip_id: 1, route_id: 1, _id: 0});

  await Promise.all(trips.map(async blockTrip => {
    const firstStoptime = await gtfs.getStoptimes({
      agency_key: timetable.agency_key,
      trip_id: blockTrip.trip_id
    }, undefined, {lean: true, sort: {stop_sequence: 1}, limit: 1});

    if (firstStoptime.length === 0) {
      throw new Error(`No stoptimes found found for trip_id=${blockTrip.trip_id}, agency_key=${blockTrip.agency_key}`);
    }

    blockTrip.firstStoptime = firstStoptime[0];

    const lastStoptime = await gtfs.getStoptimes({
      agency_key: timetable.agency_key,
      trip_id: blockTrip.trip_id
    }, undefined, {lean: true, sort: {stop_sequence: -1}, limit: 1});

    if (lastStoptime.length === 0) {
      throw new Error(`No stoptimes found found for trip_id=${blockTrip.trip_id}, agency_key=${blockTrip.agency_key}`);
    }

    blockTrip.lastStoptime = lastStoptime[0];
  }));

  return _.sortBy(trips, trip => trip.firstStoptime.departure_timestamp);
};

/*
 * Get next trip and previous trip with the same block_id if it arrives/departs
 * from the same stop and is a different route.
 */
const addTripContinuation = async (trip, timetable) => {
  if (!trip.block_id) {
    return;
  }

  const maxContinuesAsWaitingTimeSeconds = 60 * 60;

  const firstStoptime = _.first(trip.stoptimes);
  const firstStopIds = await getAllStationStopIds(firstStoptime.stop_id, trip.agency_key);
  const lastStoptime = _.last(trip.stoptimes);
  const lastStopIds = await getAllStationStopIds(lastStoptime.stop_id, trip.agency_key);
  const blockTrips = await getTripsWithSameBlock(trip, timetable);

  // "Continues From" trips must be the previous trip chronologically.
  const previousTrip = _.findLast(blockTrips, blockTrip => {
    return blockTrip.lastStoptime.arrival_timestamp <= firstStoptime.departure_timestamp;
  });

  // "Continues From" trips must be a different route_id.
  if (previousTrip && previousTrip.route_id !== trip.route_id) {
    // "Comtinues From" trips must not be more than 60 minutes before.
    if (previousTrip.lastStoptime.arrival_timestamp >= firstStoptime.departure_timestamp - maxContinuesAsWaitingTimeSeconds) {
      // "Continues From" trips must have their last stop_id be the same as the next trip's first stop_id.
      if (firstStopIds.includes(previousTrip.lastStoptime.stop_id)) {
        const routes = await gtfs.getRoutes({
          agency_key: timetable.agency_key,
          route_id: previousTrip.route_id
        });

        previousTrip.route = routes[0];

        trip.continues_from_route = previousTrip;
      }
    }
  }

  // "Continues As" trips must be the next trip chronologically.
  const nextTrip = _.find(blockTrips, blockTrip => {
    return blockTrip.firstStoptime.departure_timestamp >= lastStoptime.arrival_timestamp;
  });

  // "Continues As" trips must be a different route_id.
  if (nextTrip && nextTrip.route_id !== trip.route_id) {
    // "Comtinues As" trips must not be more than 60 minutes later.
    if (nextTrip.firstStoptime.departure_timestamp <= lastStoptime.arrival_timestamp + maxContinuesAsWaitingTimeSeconds) {
      // "Continues As" trips must have their first stop_id be the same as the previous trip's last stop_id.
      if (lastStopIds.includes(nextTrip.firstStoptime.stop_id)) {
        const routes = await gtfs.getRoutes({
          agency_key: timetable.agency_key,
          route_id: nextTrip.route_id
        });

        nextTrip.route = routes[0];
        trip.continues_as_route = nextTrip;
      }
    }
  }
};

/*
 * Get all trips from a timetable.
 */
const getTripsFromTimetable = async (timetable, calendars, config) => {
  const tripQuery = {
    agency_key: timetable.agency_key,
    route_id: timetable.route_id,
    service_id: {
      $in: timetable.serviceIds
    }
  };

  if (timetable.direction_id !== '' && timetable.direction_id !== null) {
    tripQuery.direction_id = timetable.direction_id;
  }

  const trips = await gtfs.getTrips(tripQuery);

  if (trips.length === 0) {
    config.logWarning(`No trips found for route_id=${timetable.route_id}, direction_id=${timetable.direction_id}, service_ids=${JSON.stringify(timetable.serviceIds)}, timetable_id=${timetable.timetable_id}`);
  }

  // Updated timetable.serviceIds with only the service IDs actually used in one or more trip
  timetable.serviceIds = _.uniq(_.map(trips, 'service_id'));

  const formattedTrips = [];
  await Promise.all(trips.map(async trip => {
    const formattedTrip = formatters.formatTrip(trip, timetable, calendars, config);
    formattedTrip.stoptimes = await getStoptimesByTrip(formattedTrip);

    if (timetable.show_trip_continuation) {
      await addTripContinuation(formattedTrip, timetable);

      if (formattedTrip.continues_as_route) {
        timetable.has_continues_as_route = true;
      }

      if (formattedTrip.continues_from_route) {
        timetable.has_continues_from_route = true;
      }
    }

    if (formattedTrip.stoptimes.length === 0) {
      config.logWarning(`No stoptimes found for agency_key=${timetable.agency_key}, trip_id=${formattedTrip.trip_id}, route_id=${timetable.route_id}, timetable_id=${timetable.timetable_id}`);
    }

    const frequencies = await getFrequenciesByTrip(formattedTrip, config);
    if (frequencies.length === 0) {
      formattedTrips.push(formattedTrip);
    } else {
      const frequencyTrips = generateTripsByFrequencies(formattedTrip, frequencies);
      formattedTrips.push(...frequencyTrips);
      timetable.frequencies = frequencies;
      timetable.frequencyExactTimes = _.some(frequencies, {exact_times: 1});
    }
  }));

  return sortTrips(formattedTrips, config);
};

/*
 * Discern if a day list should be shown for a specific timetable (if some
 * trips happen on different days).
 */
const getShowDayList = timetable => {
  return !_.every(timetable.orderedTrips, (trip, idx) => {
    if (idx === 0) {
      return true;
    }

    return trip.dayList === timetable.orderedTrips[idx - 1].dayList;
  });
};

/*
 * Format timetables for display.
 */
const formatTimetables = async (timetables, config) => {
  return Promise.all(timetables.map(async timetable => {
    const dayList = formatters.formatDays(timetable, config);
    const calendars = await getCalendarsFromTimetable(timetable);
    let serviceIds = _.map(calendars, 'service_id');

    if (timetable.include_exceptions === 1) {
      const calendarDatesServiceIds = await getCalendarDatesServiceIds(timetable.agency_key, timetable.start_date, timetable.end_date);
      serviceIds = _.uniq([...serviceIds, ...calendarDatesServiceIds]);
    }

    Object.assign(timetable, {
      noServiceSymbolUsed: false,
      requestDropoffSymbolUsed: false,
      noDropoffSymbolUsed: false,
      requestPickupSymbolUsed: false,
      noPickupSymbolUsed: false,
      interpolatedStopSymbolUsed: false,
      showStopCity: config.showStopCity,
      showStopDescription: config.showStopDescription,
      noServiceSymbol: config.noServiceSymbol,
      requestDropoffSymbol: config.requestDropoffSymbol,
      noDropoffSymbol: config.noDropoffSymbol,
      requestPickupSymbol: config.requestPickupSymbol,
      noPickupSymbol: config.noPickupSymbol,
      interpolatedStopSymbol: config.interpolatedStopSymbol,
      serviceIds,
      dayList,
      dayListLong: formatters.formatDaysLong(dayList, config)
    });

    timetable.orderedTrips = await getTripsFromTimetable(timetable, calendars, config);
    timetable.stops = await getStops(timetable, config);
    timetable.calendarDates = await getCalendarDates(timetable, config);
    timetable.showDayList = getShowDayList(timetable);
    timetable.timetable_label = formatters.formatTimetableLabel(timetable);

    return timetable;
  }));
};

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
exports.generateDiagramHTML = (route, config) => {
  return fileUtils.renderFile('diagram_page', {
    route,
    config
  }, config);
}
