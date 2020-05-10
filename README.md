# GTFS to Chart

`gtfs-to-chart` creates stringline charts showing all vehicles on a transit route, based on E.J. Marey's graphical train schedule.

It uses code developed by [Mike Bostock](https://observablehq.com/@mbostock/mareys-trains) for vidualizing transit data in d3 and connects it to GTFS so that any transit route from any agency can be visualized.

## Installation

If you would like to use this library as a command-line utility, you can install it globally directly from [npm](https://npmjs.org):

    npm install gtfs-to-chart -g

If you are using this as a node module as part of an application, you can include it in your project's `package.json` file.

## Command-line example

    gtfs-to-chart --configPath /path/to/your/custom-config.json

## Code example

    const gtfsToChart = require('gtfs-to-chart');
    const mongoose = require('mongoose');
    const config = require('config.json');

    mongoose.Promise = global.Promise;
    mongoose.connect(config.mongoUrl, { useNewUrlParser: true, useCreateIndex: true, useUnifiedTopology: true });

    gtfsToChart(config)
    .then(() => {
      console.log('Chart Generation Successful');
      process.exit();
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });

## Configuration

Copy `config-sample.json` to `config.json` and then add your projects configuration to `config.json`. This is a JSON file, so ensure that your config.json is valid JSON.

    cp config-sample.json config.json

All files starting with `config*.json` are .gitignored - so you can create multiple configuration files such as `config-caltrain.json`.

| option | type | description |
| ------ | ---- | ----------- |
| [`agencies`](#agencies) | array | An array of GTFS files to be imported. |
| [`beautify`](#beautify) | boolean | Whether or not to beautify the HTML output. |
| [`chartDate`](#templatepath) | string | The date to use for generating the stringline chart. |
| [`templatePath`](#templatepath) | string | Path to custom pug template for rendering chart html. |

### agencies

{Array} Specify the GTFS files to be imported in an `agencies` array. GTFS files can be imported via a `url` or a local `path`.

Each file needs an `agency_key`, a short name you create that is specific to that GTFS file. For GTFS files that contain more than one agency, you only need to list each GTFS file once in the `agencies` array, not once per agency that it contains.

To find an agency's GTFS file, visit [transitfeeds.com](http://transitfeeds.com). You can use the
URL from the agency's website or you can use a URL generated from the transitfeeds.com
API along with your API token.

* Specify a download URL:
```
{
  "agencies": [
    {
      "agency_key": "county-connection",
      "url": "http://cccta.org/GTFS/google_transit.zip"
    }
  ]
}
```

* Specify a path to a zipped GTFS file:
```
{
  "agencies": [
    {
      "agency_key": "myAgency",
      "path": "/path/to/the/gtfs.zip"
    }
  ]
}
```
* Specify a path to an unzipped GTFS file:
```
{
  "agencies": [
    {
      "agency_key": "myAgency",
      "path": "/path/to/the/unzipped/gtfs/"
    }
  ]
}
```

* Exclude files - if you don't want all GTFS files to be imported, you can specify an array of files to exclude.

```
{
  "agencies": [
    {
      "agency_key": "myAgency",
      "path": "/path/to/the/unzipped/gtfs/",
      "exclude": [
        "shapes",
        "stops"
      ]
    }
  ]
}
```

### beautify

{Boolean} Whether or not to beautify the HTML output. Defaults to `false`.

```
    "beautify": false
```

### chartDate

{String} The date to use for generating charts in YYYYMMDD format. Charts will be for service on this date. Defaults to today's date.

```
    "chartDate": "20200505"
```


### templatePath

{String} Path to a folder containing (pug)[https://pugjs.org/] template for rendering charts. This is optional. Defaults to using the templates provided in `views/chart`. All files within the `/views/custom` folder will be .gitignored, so you can copy the `views/chart` folder to `views/custom/myagency` and make any modifications needed. Any custom views folder should conatain pug templates called `chart_page.pug` and  `overview_page.pug`.

```
    "templatePath": "views/custom/my-agency/"
```

## Running

Ensure than MongoDB is running locally.

    mongod

To generate charts, run `gtfs-to-chart`.

    gtfs-to-chart

By default, `gtfs-to-chart` will look for a `config.json` file in the project root. To specify a different path for the configuration file:

    gtfs-to-chart --configPath /path/to/your/custom-config.json

This will download the GTFS file specified in `config.js` .  Then, `gtfs-to-chart` will build the HTML charts and save them in `charts/:agency_key`.

### Options

`configPath`

Allows specifying a configuration json file. Defaults to config.json in the current directory.

    gtfs-to-chart --configPath /path/to/your/custom-config.json

`skipImport`

Skips importing GTFS into MongoDB. Useful if you are rerunning with an unchanged GTFS file. If you use this option and the GTFS file hasn't been imported, you'll get an error.

    gtfs-to-chart --skipImport

## Processing very large GTFS files.

By default, node has a memory limit of 512 MB or 1 GB. Use the `max-old-space-size` option. For example to allocate 2 GB:

    node --max-old-space-size=2000 /usr/local/bin/gtfs-to-chart

## Contributing

Pull requests are welcome, as is feedback and [reporting issues](https://github.com/blinktaginc/gtfs-to-chart/issues).

### Tests

    npm test

