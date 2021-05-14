import { clearLine, cursorTo } from 'node:readline';

import { noop } from 'lodash-es';
import chalk from 'chalk';
import ProgressBar from 'progress';

/*
 * Returns a log function based on config settings
 */
export function log(config) {
  if (config.verbose === false) {
    return noop;
  }

  if (config.logFunction) {
    return config.logFunction;
  }

  return (text, overwrite) => {
    if (overwrite === true && process.stdout.isTTY) {
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
    } else {
      process.stdout.write('\n');
    }

    process.stdout.write(text);
  };
}

/*
 * Returns an warning log function based on config settings
 */
export function logWarning(config) {
  if (config.logFunction) {
    return config.logFunction;
  }

  return text => {
    process.stdout.write(`\n${formatWarning(text)}\n`);
  };
}

/*
 * Returns an error log function based on config settings
 */
export function logError(config) {
  if (config.logFunction) {
    return config.logFunction;
  }

  return text => {
    process.stdout.write(`\n${formatError(text)}\n`);
  };
}

/*
 * Format console warning text
 */
export function formatWarning(text) {
  return `${chalk.yellow.underline('Warning')}${chalk.yellow(':')} ${chalk.yellow(text)}`;
}

/*
 * Format console error text
 */
export function formatError(error) {
  const message = error instanceof Error ? error.message : error;
  return `${chalk.red.underline('Error')}${chalk.red(':')} ${chalk.red(message.replace('Error: ', ''))}`;
}

/*
 * Print a progress bar to the console.
 */
export function progressBar(formatString, barOptions, config) {
  if (barOptions.total === 0) {
    return null;
  }

  if (config.logFunction) {
    let barProgress = 0;
    const renderProgressString = () => {
      return formatString
        .replace(':current', barProgress)
        .replace(':total', barOptions.total)
        .replace('[:bar] ', '');
    };

    config.log(renderProgressString());

    return {
      interrupt: text => {
        config.logWarning(text);
      },
      tick: () => {
        barProgress += 1;
        config.log(renderProgressString());
      }
    };
  }

  const bar = new ProgressBar(formatString, barOptions);
  bar.render();

  return {
    interrupt: text => {
      bar.interrupt(text);
    },
    tick: () => {
      bar.tick();
    }
  };
}
