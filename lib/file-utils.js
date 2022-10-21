import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, mkdir } from 'node:fs/promises';

import copy from 'better-copy';
import beautify from 'js-beautify';
import { renderFile } from 'pug';
import untildify from 'untildify';

/*
 * Get the full path of the template file for generating charts based on
 * config.
 */
function getTemplatePath(templateFileName, config) {
  if (config.templatePath !== undefined) {
    return path.join(untildify(config.templatePath), `${templateFileName}.pug`);
  }

  return path.join(fileURLToPath(import.meta.url), '../../views/chart', `${templateFileName}.pug`);
}

/*
 * Prepare the specified directory for saving HTML charts by deleting
 * everything and creating the expected folders.
 */
export async function prepDirectory(exportPath) {
  const staticAssetPath = path.join(fileURLToPath(import.meta.url), '../../public');
  await rm(exportPath, { recursive: true, force: true });
  await mkdir(exportPath, { recursive: true });
  await mkdir(path.join(exportPath, 'charts'), { recursive: true });
  await copy(path.join(staticAssetPath, 'css'), path.join(exportPath, 'css'));
  await copy(path.join(staticAssetPath, 'js'), path.join(exportPath, 'js'));
}

/*
 * Render the HTML for a chart based on the config.
 */
export async function renderTemplate(templateFileName, templateVars, config) {
  const templatePath = getTemplatePath(templateFileName, config);
  let html = await renderFile(templatePath, templateVars);

  // Beautify HTML if setting is set
  if (config.beautify === true) {
    html = await beautify.html_beautify(html, { indent_size: 2 });
  }

  return html;
}
