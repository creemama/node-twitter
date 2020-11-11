"use strict";

const arrays = require("@util.js/arrays");
const asyncPipe = (...functions) => (input) =>
  functions.reduce((chain, func) => chain.then(func), Promise.resolve(input));
const errors = require("@util.js/errors");
const files = require("@util.js/files");
const json = JSON;
const numbers = require("@util.js/numbers");
const OAuthAccessTokenRequester = require("./OAuthAccessTokenRequester");
const os = require("os");
const pipe = (...functions) => (x) => functions.reduce((y, f) => f(y), x);
const objects = require("@util.js/objects");
const promises = require("@util.js/promises");
const readline = require("readline");
const RethrownError = errors.RethrownError;
const timers = require("@util.js/timers");
const Twitter = require("twitter");

module.exports = class NodeTwitter {
  async authorize(params) {
    try {
      const { screenName } = params;
      const accessToken = await new OAuthAccessTokenRequester({
        accessTokenUrl: "https://api.twitter.com/oauth/access_token",
        authorizeUrl: "https://api.twitter.com/oauth/authorize",
        requestTokenUrl: "https://api.twitter.com/oauth/request_token",
      }).requestOAuthAccessToken();
      const dir = getDirectory({ screenName });
      const jsonFile = dir + "/oauth-access-tokens.json";
      await files.mkdirp(dir);
      await files.writeFile(
        jsonFile,
        json.stringify(accessToken, null, "\t"),
        "utf8"
      );
      console.log('"' + jsonFile + '" contains your OAuth 1.0A access token.');
    } catch (e) {
      throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
    }
  }

  async follow(params) {
    try {
      const { query, screenName } = params;
      const count = pipe(
        // Get count.
        (x) => x.count,
        // Parse an integer.
        numbers.parseInt,
        // Validate the integer.
        (x) => {
          if (!numbers.isInteger(x))
            throw new TypeError('"' + x + '" is not an integer.');
          return x;
        }
      )(params);
      const dir = getDirectory({ screenName });
      const client = await getClient({ dir, screenName });
      const screenNames = await asyncPipe(
        searchRecentTweets,
        (recentTweets) => Promise.resolve({ dir, recentTweets, screenName }),
        filterRecentTweets
      )({
        client,
        dir,
        query,
        screenName,
      });
      const followedOut = files.createWriteStream(dir + "/followed.txt", {
        flags: "a",
      });
      try {
        await screenNames
          // Truncate the list.
          .slice(0, count)
          // Map the list of screen names to a list of Promises.
          .map((currentValue, index) => async () => {
            console.log(
              "Following " + (index + 1) + ": " + currentValue + "..."
            );
            try {
              await createFriendship({ client, dir, screenName: currentValue });
            } catch (e) {
              // Let us continue if we get code 162.
              // [{"code":162,"message":"You have been blocked from following this account at the request of the user."}]
              const originalError = e.original;
              if (originalError[0].code !== 162) throw e;
              console.log(currentValue + " blocked " + screenName + ".");
            }
            await promises.callCallback(
              followedOut,
              followedOut.write,
              currentValue + "\n",
              "utf8"
            );
          })
          // Execute each Promise one after the other.
          .reduce(
            (accumulator, currentValue) => accumulator.then(currentValue),
            Promise.resolve()
          );
      } finally {
        await promises.callCallback(followedOut, followedOut.end);
      }
    } catch (e) {
      throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
    }
  }

  async unfollow(params) {
    try {
      const { screenName } = params;
      const dir = getDirectory({ screenName });
      const client = await getClient({ dir, screenName });
      await deleteJsonFiles({
        dir,
        filePrefix: "friendships",
      });
      await deleteJsonFiles({
        dir,
        filePrefix: "friends",
      });
      const friendsScreenNames = await listFriendsScreenNames({
        client,
        dir,
        screenName,
      });
      const friendships = await lookUpFriendships({
        client,
        dir,
        friendsScreenNames,
        screenName,
      });
      const notFollowingBack = await getNotFollowingBack({
        dir,
        friendships,
        screenName,
      });
      await unfollowNotFollowingBack({
        client,
        dir,
        notFollowingBack,
        screenName,
      });
    } catch (e) {
      throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
    }
  }
};

async function createFriendship(params) {
  try {
    const { client, dir, screenName } = params;
    await timers.setTimeoutPromise(10000); // milliseconds = 10 seconds
    // https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/post-friendships-create
    const jsonObj = await promises.callCallback(
      client,
      client.post,
      "friendships/create",
      {
        follow: false,
        screen_name: screenName,
      }
    );
    await files.writeFile(
      dir + "/friendships-create.json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function deleteJsonFiles(params) {
  try {
    const { dir, filePrefix } = params;
    const fileID = pipe(
      (x) => params.fileID,
      (x) => (numbers.isInteger(x) ? x : 0)
    );
    const file = dir + "/" + filePrefix + "." + fileID + ".json";
    if (!files.existsSync(file)) return;
    await files.unlink(file);
    await deleteJsonFiles({
      dir,
      fileID: fileID + 1,
      filePrefix,
    });
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function filterRecentTweets(params) {
  try {
    const { dir, recentTweets, screenName } = params;
    const blacklist = new Set(
      (
        await readFriendsScreeNames({
          dir,
          screenName,
        })
      )
        .concat(await readLines(dir + "/followed.txt"))
        .concat(
          await readNotFollowingBackScreenNames({
            dir,
            screenName,
          })
        )
    );
    const screenNames = [
      ...new Set(
        recentTweets
          .filter(
            (status) => status.user.friends_count >= status.user.followers_count
          )
          .map((status) => status.user.screen_name)
      ),
    ].filter((screenName) => !blacklist.has(screenName));
    console.log(
      screenNames.length +
        " of " +
        recentTweets.length +
        " screen names are usable."
    );
    return screenNames;
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function getClient(params) {
  try {
    const { dir, screenName } = params;
    return new Twitter(
      json.parse(
        await files.readFile(dir + "/oauth-access-tokens.json", "utf8")
      )
    );
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

function getDirectory(params) {
  const { screenName } = params;
  const dir = os.homedir() + "/.node-twitter/" + screenName;
  console.log("node-twitter data dir: " + dir);
  return dir;
}

async function getNextNotFollowingBackFile(params) {
  const fileID = pipe(
    (x) => x.fileID,
    (x) => (objects.isDefined(x) ? x : 0)
  )(params || {});
  const file = dir + "/not-following-back." + fileID + ".json";
  if (!files.existsSync(file)) return file;
  return await getNextNotFollowingBackFile({
    fileID: fileID + 1,
  });
}

async function getNotFollowingBack(params) {
  try {
    const { dir, friendships, screenName } = params;
    const whitelist = (await readWhitelist({ dir, screenName })).map(
      (user) => user.screen_name
    );
    const notFollowingBack = friendships
      .map((currentValue, index) => {
        const valueWithIndex = objects.assign({}, currentValue);
        valueWithIndex.ordinal = index;
        return valueWithIndex;
      })
      .filter(
        (friendship) =>
          !friendship.connections.includes("followed_by") &&
          !whitelist.includes(friendship.screen_name) &&
          friendship.ordinal > 60
      );
    await files.writeFile(
      await getNextNotFollowingBackFile(),
      json.stringify(notFollowingBack, null, "\t"),
      "utf8"
    );
    return notFollowingBack;
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function listFriendsScreenNames(params) {
  try {
    const { client, dir, screenName } = params;
    const cursor = pipe(
      (x) => x.cursor,
      (x) => (objects.isDefined(x) ? x : -1)
    )(params);
    const friendsScreenNames = pipe(
      (x) => x.friendsScreenNames,
      (x) => (objects.isDefined(x) ? x : [])
    )(params);
    const requestNum = pipe(
      (x) => x.requestNum,
      (x) => (objects.isDefined(x) ? x : 0)
    )(params);
    // https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friends-list
    const jsonObj = await promises.callCallback(
      client,
      client.get,
      "friends/list",
      {
        count: 200,
        cursor,
        include_user_entities: false,
        skip_status: true,
        screen_name: screenName,
      }
    );
    await files.mkdirp(dir);
    await files.writeFile(
      dir + "/friends." + requestNum + ".json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
    if (jsonObj[0].next_cursor === 0) return friendsScreenNames;
    await timers.setTimeoutPromise(60000); // milliseconds = 1 minute
    await listFriendsScreenNames({
      client,
      cursor: jsonObj[0].next_cursor,
      dir,
      friendsScreenNames: friendsScreenNames.concat(
        jsonObj[0].users.map((x) => x.screen_name)
      ),
      requestNum: requestNum + 1,
      screenName,
    });
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function lookUpFriendships(params) {
  try {
    const { client, dir, friendsScreenNames, screenName } = params;
    const screenNames = await readFriendsScreeNames({ dir, screenName });
    const friendships = pipe(
      (x) => x.friendships,
      (x) => (objects.isDefined(x) ? x : [])
    )(params);
    const i = pipe(
      (x) => x.i,
      (x) => (objects.isDefined(x) ? x : 0)
    )(params);
    const requestNum = pipe(
      (x) => x.requestNum,
      (x) => (objects.isDefined(x) ? x : 0)
    )(params);
    if (i >= screenNames.length) return friendships;
    const screenNamesSubset = screenNames.slice(i, i + 100);
    // https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-lookup
    const jsonObj = await promises.callCallback(
      client,
      client.get,
      "friendships/lookup",
      {
        screen_name: screenNamesSubset.join(","),
      }
    );
    await files.writeFile(
      dir + "/friendships." + requestNum + ".json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
    await timers.setTimeoutPromise(60000); // milliseconds = 1 minute
    await lookUpFriendships({
      client,
      dir,
      friendships: friendships.concat(jsonObj[0]),
      friendsScreenNames,
      i: i + 100,
      requestNum: requestNum + 1,
      screenName,
    });
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function readFriendsScreeNames(params) {
  try {
    const { dir, screenName } = params;
    const jsonNum = pipe(
      (x) => x.jsonNum,
      (x) => (objects.isDefined(x) ? x : 0)
    )(params);
    const friendsScreenNames = pipe(
      (x) => x.friendsScreenNames,
      (x) => (objects.isDefined(x) ? x : [])
    )(params);
    const file = dir + "/friends." + jsonNum + ".json";
    if (!files.existsSync(file)) return friendsScreenNames;
    const jsonStr = await files.readFile(file, "utf8");
    const jsonObj = json.parse(jsonStr);
    return await readFriendsScreeNames({
      dir,
      jsonNum: jsonNum + 1,
      screenName,
      friendsScreenNames: friendsScreenNames.concat(
        jsonObj[0].users.map((x) => x.screen_name)
      ),
    });
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

function readLines(file) {
  return new Promise((resolve, reject) => {
    if (!files.existsSync(file)) {
      resolve([]);
      return;
    }
    const lineReader = readline.createInterface({
      input: files.createReadStream(file),
    });
    let lines = [];
    lineReader.on("line", (line) => {
      lines.push(line);
    });
    lineReader.on("close", () => {
      resolve(lines);
    });
  });
}

async function readNotFollowingBackScreenNames(params) {
  try {
    const { dir, screenName } = params;
    const result = pipe(
      (x) => params.result,
      (x) => (arrays.isArray(x) ? x : [])
    )(params);
    const fileID = pipe(
      (x) => params.fileID,
      (x) => (numbers.isInteger(x) ? x : 0)
    )(params);
    const file = dir + "/not-following-back." + fileID + ".json";
    if (!files.existsSync(file)) return result;
    const jsonStr = await files.readFile(file, "utf8");
    return await readNotFollowingBackScreenNames({
      dir,
      fileID: fileID + 1,
      result: result.concat(
        json.parse(jsonStr).map((user) => user.screen_name)
      ),
      screenName,
    });
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function readWhitelist(params) {
  const { dir, screenName } = params;
  try {
    const file = dir + "/whitelist.json";
    if (!files.existsSync(file)) return [];
    const jsonStr = await files.readFile(file, "utf8");
    return json.parse(jsonStr);
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function searchRecentTweets(params) {
  try {
    const { client, dir, query, screenName } = params;
    // https://developer.twitter.com/en/docs/twitter-api/v1/tweets/search/api-reference/get-search-tweets
    const jsonObj = await promises.callCallback(
      client,
      client.get,
      "search/tweets",
      {
        count: 100,
        include_entities: false,
        q: query,
        result_type: "recent",
      }
    );
    await files.mkdirp(dir);
    await files.writeFile(
      dir + "/search-tweets.json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
    return jsonObj[0].statuses;
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}

async function unfollowNotFollowingBack(params) {
  try {
    const { client, dir, notFollowingBack, screenName } = params;
    // Map the list of users to a list of Promises.
    await notFollowingBack
      .forEach(async (user) => {
        console.log(
          "Unfollowing " + user.ordinal + ": " + user.screen_name + "..."
        );
        // https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/post-friendships-destroy
        const jsonObj = await promises.callCallback(
          client,
          client.post,
          "friendships/destroy",
          {
            screen_name: user.screen_name,
          }
        );
        await files.writeFile(
          dir + "/friendships-destroy.json",
          json.stringify(jsonObj, null, "\t"),
          "utf8"
        );
        await timers.setTimeoutPromise(10000); // milliseconds = 10 seconds
      })
      // Execute each Promise one after the other.
      .reduce(
        (accumulator, currentValue) => accumulator.then(currentValue),
        Promise.resolve()
      );
  } catch (e) {
    throw new RethrownError(e, e instanceof Error ? null : JSON.stringify(e));
  }
}
