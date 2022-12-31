/* global _, d3, moment, chartData */
/* eslint no-var: "off", prefer-arrow-callback: "off", no-unused-vars: "off" */

function parseTime(string) {
  const timeParser = d3.utcParse('%H:%M:%S');
  const date = timeParser(string);
  return date;
}

function padTimeRange(range) {
  return [
    moment(range[0]).startOf('hour'),
    moment(range[1]).add(30, 'minutes')
  ];
}

function geStopsFromStoptimes(stoptimes, stations) {
  return stoptimes.reduce((memo, stoptime) => {
    const station = stations.find((station) => station.stop_id === stoptime.stop_id);
    if (stoptime.arrival_time === stoptime.departure_time) {
      memo.push({
        station,
        time: parseTime(stoptime.arrival_time),
        type: 'stop'
      });
    } else {
      memo.push(
        {
          station,
          time: parseTime(stoptime.arrival_time),
          type: 'arrival'
        }, {
          station,
          time: parseTime(stoptime.departure_time),
          type: 'departure'
        }
      );
    }

    return memo;
  }, []);
}

function formatStopTime(stop) {
  const timeFormatter = d3.utcFormat('%-I:%M %p');
  let formattedTime = '';

  if (stop.type === 'arrival') {
    formattedTime += 'Arrives at ';
  } else if (stop.type === 'departure') {
    formattedTime += 'Departs at ';
  }

  formattedTime += timeFormatter(stop.time);
  return formattedTime;
}

function getPrimaryDirectionId(stations) {
  const directionGroups = _.groupBy(stations, 'direction_id');
  const largestDirectionGroup = _.maxBy(Object.values(directionGroups), (group) => group.length);
  return largestDirectionGroup[0].direction_id;
}

function renderChart(data) {
  const {
    trips,
    stations
  } = data;

  const formattedTrips = trips.map((trip) => ({
    number: trip.trip_id,
    direction: trip.direction_id,
    trip_headsign: trip.trip_headsign,
    stops: geStopsFromStoptimes(trip.stoptimes, stations)
  }));

  const stops = formattedTrips.flatMap((trip) => trip.stops.map((stop) => ({
    trip,
    stop
  })));

  const height = 2400;
  const width = 800;
  const topMargin = 20 + (_.max(_.map(stations, (station) => station.name.length)) * 4.6);
  const margin = ({ top: topMargin, right: 30, bottom: topMargin, left: 50 });

  const primaryDirectionId = getPrimaryDirectionId(stations);

  const line = d3.line()
    .x((d) => x(d.station.distance))
    .y((d) => y(d.time));

  const x = d3.scaleLinear()
    .domain(d3.extent(stations, (d) => d.distance))
    .range([margin.left + 10, width - margin.right]);

  const y = d3.scaleUtc()
    .domain(padTimeRange(d3.extent(stops, (s) => s.stop.time)))
    .range([margin.top, height - margin.bottom]);

  const xAxis = (g) => g
    .style('font', '10px sans-serif')
    .selectAll('g')
    .data(stations)
    .join('g')
    .attr('transform', (d) => `translate(${x(d.distance)},0)`)
    .call((g) => g.append('line')
      .attr('y1', margin.top - 6)
      .attr('y2', margin.top)
      .attr('stroke', 'currentColor'))
    .call((g) => g.append('line')
      .attr('y1', height - margin.bottom + 6)
      .attr('y2', height - margin.bottom)
      .attr('stroke', 'currentColor'))
    .call((g) => g.append('line')
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke-opacity', 0.2)
      .attr('stroke-dasharray', '1.5,2')
      .attr('stroke', 'currentColor'))
    .call((g) => g.append('text')
      .attr('transform', `translate(0,${margin.top}) rotate(-90)`)
      .attr('x', 12)
      .attr('dy', '0.35em')
      .text((d) => d.name))
    .style('display', (d) => d.direction_id === primaryDirectionId ? 'block' : 'none')
    .call((g) => g.append('text')
      .attr('text-anchor', 'end')
      .attr('transform', `translate(0,${height - margin.top}) rotate(-90)`)
      .attr('x', -12)
      .attr('dy', '0.35em')
      .text((d) => d.name));

  const yAxis = (g) => g
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y)
      .ticks(d3.utcHour)
      .tickFormat(d3.utcFormat('%-I %p')))
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('.tick line').clone().lower()
      .attr('stroke-opacity', 0.2)
      .attr('x2', width));

  const voronoi = d3.Delaunay
    .from(stops, (d) => x(d.stop.station.distance), (d) => y(d.stop.time))
    .voronoi([0, 0, width, height]);

  const tooltip = (g) => {
    const tooltip = g.append('g')
      .style('font', '10px sans-serif');

    const path = tooltip.append('path')
      .attr('fill', 'white');

    const text = tooltip.append('text');

    const line1 = text.append('tspan')
      .attr('x', 0)
      .attr('y', 0)
      .style('font-weight', 'bold');

    const line2 = text.append('tspan')
      .attr('x', 0)
      .attr('y', '1.1em');

    const line3 = text.append('tspan')
      .attr('x', 0)
      .attr('y', '2.2em');

    g.append('g')
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .selectAll('path')
      .data(stops)
      .join('path')
      .attr('d', (d, i) => voronoi.renderCell(i))
      .on('mouseout', () => tooltip.style('display', 'none'))
      .on('mouseover', (d) => {
        tooltip.style('display', null);
        line1.text(`Trip ${d.trip.number} to ${d.trip.trip_headsign}`);
        line2.text(d.stop.station.name);
        line3.text(formatStopTime(d.stop));
        path.attr('stroke', 'rgb(34, 34, 34)');
        const box = text.node().getBBox();
        path.attr('d', `
            M${box.x - 10},${box.y - 10}
            H${(box.width / 2) - 5}l5,-5l5,5
            H${box.width + 10}
            v${box.height + 20}
            h-${box.width + 20}
            z
          `);
        tooltip.attr('transform', `translate(${
          x(d.stop.station.distance) - (box.width / 2)},${
          y(d.stop.time) + 28
        })`);
      });
  };

  const svg = d3.select('#chart')
    .append('svg')
    .attr('viewBox', [0, 0, width, height]);

  svg.append('g')
    .call(xAxis);

  svg.append('g')
    .call(yAxis);

  const vehicle = svg.append('g')
    .attr('stroke-width', 1.5)
    .selectAll('g')
    .data(formattedTrips)
    .join('g');

  vehicle.append('path')
    .attr('fill', 'none')
    .attr('stroke', (d) => 'rgb(34, 34, 34)')
    .attr('d', (d) => line(d.stops));

  vehicle.append('g')
    .attr('stroke', 'white')
    .attr('fill', (d) => 'rgb(34, 34, 34)')
    .selectAll('circle')
    .data((d) => d.stops)
    .join('circle')
    .attr('transform', (d) => `translate(${x(d.station.distance)},${y(d.time)})`)
    .attr('r', 2.5);

  svg.append('g')
    .call(tooltip);
}

renderChart(chartData);
