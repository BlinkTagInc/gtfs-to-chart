const path = require('path');

const beautify = require('js-beautify').html_beautify;
const fs = require('fs-extra');
const pug = require('pug');
const untildify = require('untildify');

/*
 * Get the full path of the template file for generating charts based on
 * config.
 */
function getTemplatePath(templateFileName, config) {
  if (config.templatePath !== undefined) {
    return path.join(untildify(config.templatePath), `${templateFileName}.pug`);
  }

  return path.join(__dirname, '..', 'views/chart/', `${templateFileName}.pug`);
}

/*
 * Prepare the specified directory for saving HTML charts by deleting
 * everything and creating the expected folders.
 */
exports.prepDirectory = async exportPath => {
  const staticAssetPath = path.join(__dirname, '..', 'public');
  await fs.remove(exportPath);
  await fs.ensureDir(exportPath);
  await fs.copy(path.join(staticAssetPath, 'css'), path.join(exportPath, 'css'));
  await fs.copy(path.join(staticAssetPath, 'js'), path.join(exportPath, 'js'));
};

/*
 * Render the HTML for a chart based on the config.
 */
exports.renderFile = async (templateFileName, templateVars, config) => {
  const templatePath = getTemplatePath(templateFileName, config);
  let html = await pug.renderFile(templatePath, templateVars);

  // Beautify HTML if setting is set
  if (config.beautify === true) {
    html = await beautify(html, { indent_size: 2 });
  }

  return html;
};
