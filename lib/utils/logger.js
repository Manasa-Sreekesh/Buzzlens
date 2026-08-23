const chalk = require('chalk');

module.exports = {
  info: (msg) => console.log(chalk.cyan(msg)),
  success: (msg) => console.log(chalk.green(msg)),
  warn: (msg) => console.log(chalk.yellow(msg)),
  error: (msg) => console.log(chalk.red(msg)),
  step: (msg) => console.log(chalk.dim(msg)),
  heading: (msg) => console.log(chalk.bold.white(`\n${msg}`)),
};
