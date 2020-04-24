const moment = require('moment');

/*
 * Convert a GTFS formatted time string into a moment less than 24 hours.
 */
exports.fromGTFSTime = timeString => {
  const duration = moment.duration(timeString);

  return moment({
    hour: duration.hours(),
    minute: duration.minutes(),
    second: duration.seconds()
  });
};

/*
 * Convert a moment into a GTFS formatted time string.
 */
exports.toGTFSTime = time => {
  return time.format('HH:mm:ss');
};

/*
 * Convert a GTFS formatted date string into a moment.
 */
exports.fromGTFSDate = gtfsDate => moment(gtfsDate, 'YYYYMMDD');

/*
 * Get number of minutes after midnight of a GTFS formatted time string.
 */
exports.minutesAfterMidnight = timeString => {
  return moment.duration(timeString).asMinutes();
};
