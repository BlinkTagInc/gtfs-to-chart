import type { Gtfs } from 'gtfs';
import type { ChartData, ChartTrip, Station, StopTime } from '../types.ts';
import type { ResolvedConfig } from '../config/config.ts';
import { parseTime, formatTime } from './time.ts';

function distance(
  a: { stop_lat: number | null; stop_lon: number | null },
  b: { stop_lat: number | null; stop_lon: number | null },
): number {
  if (
    a.stop_lat === null ||
    a.stop_lon === null ||
    b.stop_lat === null ||
    b.stop_lon === null
  ) {
    throw new Error('Cannot calculate distance for a stop without coordinates');
  }
  const radians = Math.PI / 180;
  const cosine =
    Math.sin(a.stop_lat * radians) * Math.sin(b.stop_lat * radians) +
    Math.cos(a.stop_lat * radians) *
      Math.cos(b.stop_lat * radians) *
      Math.cos((a.stop_lon - b.stop_lon) * radians);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 3958.8;
}

/** Returns null when the route has no service on the requested date. */
export async function getChartData(
  gtfs: Gtfs,
  sourceId: string,
  config: ResolvedConfig['charts'],
  routeId: string,
): Promise<ChartData | null> {
  const rows = await gtfs.query
    .activeTrips({ serviceDate: config.serviceDate, routeId })
    .where({ source_id: sourceId })
    .orderBy([{ field: 'trip_id', direction: 'asc' }])
    .all();
  if (rows.length === 0) {
    return null;
  }
  let trips: ChartTrip[] = [];
  // Keep the first departure before filtering: frequency offsets use the original trip origin.
  const origins = new Map<string, number>();
  for (const row of rows) {
    const times = await gtfs.schedule.stopTimes
      .where({ source_id: sourceId, trip_id: row.trip_id })
      .orderBy([{ field: 'stop_sequence', direction: 'asc' }])
      .all();
    const origin = times[0]?.departure_time;
    if (origin) {
      origins.set(row.trip_id, parseTime(origin));
    }
    const stoptimes: StopTime[] = [];
    for (const time of times) {
      if (
        !time.stop_id ||
        !time.arrival_time ||
        !time.departure_time ||
        (config.timepointsOnly && time.timepoint === 0)
      ) {
        continue;
      }
      parseTime(time.arrival_time);
      parseTime(time.departure_time);
      stoptimes.push({
        ...time,
        stop_id: time.stop_id,
        arrival_time: time.arrival_time,
        departure_time: time.departure_time,
      });
    }
    if (stoptimes.length >= 2) {
      trips.push({
        trip_id: row.trip_id,
        trip_headsign: row.trip_headsign,
        direction_id: row.direction_id,
        stoptimes,
      });
    }
  }
  const frequencies = await gtfs.schedule.frequencies
    .where({ source_id: sourceId })
    .all();
  const templates = new Map(trips.map((trip) => [trip.trip_id, trip]));
  const frequencyIds = new Set(
    frequencies.map((frequency) => frequency.trip_id),
  );
  trips = trips.filter((trip) => !frequencyIds.has(trip.trip_id));
  const notes = new Set<string>();
  for (const frequency of frequencies) {
    const template = templates.get(frequency.trip_id);
    if (!template) {
      continue;
    }
    const origin = origins.get(template.trip_id);
    if (origin === undefined) {
      throw new Error(
        `Frequency trip ${template.trip_id} has no first departure time`,
      );
    }
    const start = parseTime(frequency.start_time);
    const end = parseTime(frequency.end_time);
    if (
      !Number.isInteger(frequency.headway_secs) ||
      frequency.headway_secs <= 0 ||
      end <= start
    ) {
      throw new Error(
        `Invalid frequency interval for trip ${template.trip_id}`,
      );
    }
    if (frequency.exact_times !== 1) {
      notes.add(
        'Frequency-based trips show representative departures; actual departure times may vary.',
      );
    }
    for (
      let departure = start;
      departure < end;
      departure += frequency.headway_secs
    ) {
      trips.push({
        ...template,
        trip_id: `${template.trip_id}_${formatTime(departure)}`,
        stoptimes: template.stoptimes.map((time) => ({
          ...time,
          arrival_time: formatTime(
            departure + parseTime(time.arrival_time) - origin,
          ),
          departure_time: formatTime(
            departure + parseTime(time.departure_time) - origin,
          ),
        })),
      });
    }
  }
  if (trips.length === 0) {
    throw new Error(
      `Route ${routeId} has service but no trips with at least two usable timed stops`,
    );
  }
  const stopRows = await gtfs.schedule.stops
    .where({ source_id: sourceId })
    .all();
  const stops = new Map(stopRows.map((stop) => [stop.stop_id, stop]));
  const groups = new Map<number | null, ChartTrip[]>();
  for (const trip of trips) {
    const group = groups.get(trip.direction_id) ?? [];
    group.push(trip);
    groups.set(trip.direction_id, group);
  }
  const orderedGroups = [...groups.values()].sort(
    (a, b) =>
      Math.max(...b.map((trip) => trip.stoptimes.length)) -
      Math.max(...a.map((trip) => trip.stoptimes.length)),
  );
  const stations: Station[] = [];
  let primaryDistance = 0;
  for (const [groupIndex, group] of orderedGroups.entries()) {
    const longest = [...group].sort(
      (a, b) => b.stoptimes.length - a.stoptimes.length,
    )[0];
    if (!longest) {
      continue;
    }
    const useShape = longest.stoptimes.every(
      (time, index, times) =>
        time.shape_dist_traveled !== null &&
        (index === 0 ||
          time.shape_dist_traveled >=
            (times[index - 1]?.shape_dist_traveled ?? 0)),
    );
    if (!useShape) {
      notes.add('Distance between stops calculated assuming a straight line.');
    }
    let cumulative = 0;
    const directionStations = longest.stoptimes.map((time, index) => {
      const stop = stops.get(time.stop_id);
      if (!stop) {
        throw new Error(`Missing stop ${time.stop_id}`);
      }
      if (useShape) {
        cumulative =
          (time.shape_dist_traveled ?? 0) -
          (longest.stoptimes[0]?.shape_dist_traveled ?? 0);
      } else if (index > 0) {
        const previousTime = longest.stoptimes[index - 1];
        const previous = previousTime
          ? stops.get(previousTime.stop_id)
          : undefined;
        if (!previous) {
          throw new Error('Missing previous stop');
        }
        cumulative += distance(previous, stop);
      }
      return {
        stop_id: time.stop_id,
        name: stop.stop_name ?? time.stop_id,
        distance: cumulative,
        direction_id: longest.direction_id,
      };
    });
    if (groupIndex === 0) {
      primaryDistance = cumulative;
    } else {
      for (const station of directionStations) {
        station.distance =
          cumulative === 0
            ? 0
            : ((cumulative - station.distance) * primaryDistance) / cumulative;
      }
    }
    stations.push(...directionStations);
    const known = new Set(directionStations.map((station) => station.stop_id));
    for (const trip of group) {
      if (trip.stoptimes.some((time) => !known.has(time.stop_id))) {
        notes.add(
          'Trips with stops outside the longest pattern in their direction are omitted.',
        );
        trips = trips.filter((candidate) => candidate !== trip);
      }
    }
  }
  return { trips, stations, notes: [...notes] };
}
