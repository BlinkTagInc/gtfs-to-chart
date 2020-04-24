const _ = require('lodash');
const moment = require('moment');

const timeUtils = require('./time-utils');

/*
 * Replace all instances in a string with items from an object.
 */
function replaceAll(string, mapObject) {
  const re = new RegExp(Object.keys(mapObject).join('|'), 'gi');
  return string.replace(re, matched => mapObject[matched]);
}

/*
 * Format a date for display. Edited by Pawajoro - added custom format
 */
exports.formatDate = (date, dateFormat) => {
  if (date.holiday_name) {
    return date.holiday_name;
  }

  return moment(date.date, 'YYYYMMDD').format(dateFormat);
};

/*
 * Time to seconds
 */
exports.timeToSeconds = time => moment.duration(time).asSeconds();

/*
 * Find hourly times for each stop for hourly schedules.
 */
function filterHourlyTimes(stops) {
  // Find all stoptimes within the first 60 minutes
  const firstStopTimes = [];
  const firstTripMinutes = timeUtils.minutesAfterMidnight(stops[0].trips[0].arrival_time);
  for (const trip of stops[0].trips) {
    const minutes = timeUtils.minutesAfterMidnight(trip.arrival_time);
    if (minutes >= firstTripMinutes + 60) {
      break;
    }

    firstStopTimes.push(timeUtils.fromGTFSTime(trip.arrival_time));
  }

  // Sort stoptimes by minutes for first stop
  const firstStopTimesAndIndex = firstStopTimes.map((time, idx) => ({idx, time}));
  const sortedFirstStopTimesAndIndex = _.sortBy(firstStopTimesAndIndex, item => {
    return parseInt(item.time.format('m'), 10);
  });

  // Filter and arrange stoptimes for all stops based on sort
  return stops.map(stop => {
    stop.hourlyTimes = sortedFirstStopTimesAndIndex.map(item => {
      return timeUtils.fromGTFSTime(stop.trips[item.idx].arrival_time).format(':mm');
    });

    return stop;
  });
}

/*
 * Format a calendar's list of days for display using abbrivated day names.
 * Edited by Pawajoro - custom days strings
 */
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
exports.formatDays = (calendar, config) => {
  const daysShort = config.daysShortStrings;
  let daysInARow = 0;
  let dayString = '';

  if (!calendar) {
    return '';
  }

  for (let i = 0; i <= 6; i += 1) {
    const currentDayOperating = (calendar[days[i]] === 1);
    const previousDayOperating = (i > 0) ? (calendar[days[i - 1]] === 1) : false;
    const nextDayOperating = (i < 6) ? (calendar[days[i + 1]] === 1) : false;

    if (currentDayOperating) {
      if (dayString.length > 0) {
        if (!previousDayOperating) {
          dayString += ', ';
        } else if (daysInARow === 1) {
          dayString += '-';
        }
      }

      daysInARow += 1;

      if (dayString.length === 0 || !nextDayOperating || i === 6 || !previousDayOperating) {
        dayString += daysShort[i];
      }
    } else {
      daysInARow = 0;
    }
  }

  if (dayString.length === 0) {
    dayString = 'No regular service days';
  }

  return dayString;
};

/* 
 * Format a route name.
 */
exports.formatRouteName = route => {
  if (route.route_short_name !== '' && route.route_short_name !== undefined) {
    return route.route_short_name;
  }
  
  return route.route_long_name;
}
