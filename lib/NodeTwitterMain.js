"use strict";

const chalk = require("chalk");
const NodeTwitter = require("./NodeTwitter");
const { RethrownError } = require("@util.js/errors");

module.exports = class NodeTwitterMain {
  main() {
    processCommand(process.argv).catch((error) => {
      console.error(chalk.red(error.stack));
      process.exit(1);
    });
  }
};

async function processCommand(argv) {
  try {
    const nodeTwitter = new NodeTwitter();
    switch (
      argv[3] // command
    ) {
      case "authorize":
        await nodeTwitter.authorize({
          screenName: argv[2],
        });
        break;
      case "follow":
        await nodeTwitter.follow({
          numToFollow: argv[4],
          query: argv[5],
          screenName: argv[2],
        });
        break;
      case "unfollow":
        await nodeTwitter.unfollow({
          screenName: argv[2],
        });
        break;
      default:
        if (argv[2]) {
          if (argv[3]) console.error(chalk.red(argv[3] + " is not a command."));
          else console.error(chalk.red("Enter a command."));
          outputHelp();
          process.exit(1);
        } else {
          outputHelp();
        }
    }
  } catch (e) {
    throw new RethrownError(e);
  }
}

function outputHelp() {
  // Update node-twitter's usage in README.md if you update the usage here.
  console.log();
  console.log(
    "  " +
      chalk.bold("node-twitter") +
      " <screen-name> <command> [command-args]"
  );
  console.log();
  console.log("  " + chalk.gray("Commands:"));
  console.log();
  console.log("    authorize");
  console.log("    follow [num-to-follow] [query]");
  console.log("    unfollow");
  console.log();
  console.log("  " + chalk.gray("Examples:"));
  console.log();
  console.log("  " + chalk.gray("-") + " Output help.");
  console.log("    " + chalk.cyan("$ node-twitter"));
  console.log(
    "  " +
      chalk.gray("-") +
      " Authorize node-twitter to access screen-name's tweets using your Twitter"
  );
  console.log("    developer account.");
  console.log("    " + chalk.cyan("$ node-twitter screen-name authorize"));
  console.log(
    "  " +
      chalk.gray("-") +
      " Follow 10 unique users, where their number of followers is greater than the"
  );
  console.log(
    "    number they are following, querying tweets with the hashtag #javascript."
  );
  console.log(
    "    " + chalk.cyan('$ node-twitter screen-name follow 10 "#javascript"')
  );
  console.log(
    "  " +
      chalk.gray("-") +
      " Unfollow all users not following screen-name back."
  );
  console.log("    " + chalk.cyan("$ node-twitter screen-name unfollow"));
  console.log();
  console.log();
}
