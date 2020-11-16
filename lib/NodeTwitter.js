"use strict";

const asyncPipe = (...functions) => (input) =>
  functions.reduce((chain, func) => chain.then(func), Promise.resolve(input));
const errors = require("@util.js/errors");
const files = require("@util.js/node-files");
const json = JSON;
const numbers = require("@util.js/numbers");
const OAuthAccessTokenRequester = require("./OAuthAccessTokenRequester");
const os = require("os");
const pipe = (...functions) => (x) => functions.reduce((y, f) => f(y), x);
const objects = require("@util.js/objects");
const promises = require("@util.js/promises");
const readline = require("readline");
const RethrownError = errors.RethrownError;
const timers = require("@util.js/node-timers");
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
      throw new RethrownError(e);
    }
  }

  async follow(params) {
    try {
      const { query, screenName } = params;
      const numToFollow = pipe(
        // Get numToFollow.
        (x) => x.numToFollow,
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
      const screenNames = await getScreenNamesToFollow({
        client,
        dir,
        numToFollow,
        query,
        screenName,
      });
      const followedOut = files.createWriteStream(dir + "/followed.txt", {
        flags: "a",
      });
      try {
        await screenNames
          // Truncate the list.
          .slice(0, numToFollow)
          // Map the list of screen names to a list of Promises.
          .map((currentValue, index, array) => async () => {
            if (index !== 0)
              // friendships/create is rate limited. Twitter allows 400 requests per user per
              // 24-hour window and 1000 requests per app per 24-hour window.
              await timers.setTimeoutPromise(10000); // milliseconds = 10 seconds
            console.log(
              "Following " +
                (index + 1) +
                " of " +
                array.length +
                ": " +
                currentValue +
                "..."
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
      throw new RethrownError(e);
    }
  }

  async unfollow(params) {
    try {
      const { screenName } = params;
      const dir = getDirectory({ screenName });
      const client = await getClient({ dir, screenName });
      await asyncPipe(
        deleteJsonFiles({
          dir,
          filePrefix: "friendships",
        }),
        deleteJsonFiles({
          dir,
          filePrefix: "friends",
        }),
        () =>
          listFriendsScreenNames({
            client,
            dir,
            screenName,
          }),
        lookUpFriendships({
          client,
          dir,
          screenName,
        }),
        getNotFollowingBack({
          dir,
          screenName,
        }),
        unfollowNotFollowingBack({
          client,
          dir,
          screenName,
        })
      )();
    } catch (e) {
      throw new RethrownError(e);
    }
  }
};

async function createFriendship(params) {
  try {
    const { client, dir, screenName } = params;
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
    throw new RethrownError(e);
  }
}

async function deleteJsonFiles(params) {
  try {
    const { dir, filePrefix } = params;
    const fileID = objects.isDefined(params.fileID) ? params.fileID : 0;
    const file = dir + "/" + filePrefix + "." + fileID + ".json";
    if (!files.existsSync(file)) return;
    await files.unlink(file);
    await deleteJsonFiles({
      dir,
      fileID: fileID + 1,
      filePrefix,
    });
  } catch (e) {
    throw new RethrownError(e);
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
    return screenNames;
  } catch (e) {
    throw new RethrownError(e);
  }
}

async function getClient(params) {
  const { dir, screenName } = params;
  try {
    return new Twitter(
      json.parse(
        await files.readFile(dir + "/oauth-access-tokens.json", "utf8")
      )
    );
  } catch (e) {
    // ENOENT (Error NO ENTry) means there is no such file or directory.
    if (e.code === "ENOENT")
      throw new RethrownError(
        e,
        'Run "node-twitter ' + screenName + ' authorize".'
      );
    throw new RethrownError(e);
  }
}

function getDirectory(params) {
  const { screenName } = params;
  const dir = os.homedir() + "/.node-twitter/" + screenName;
  console.log("node-twitter data dir: " + dir);
  return dir;
}

async function getNextNotFollowingBackFile(params) {
  const { dir } = params;
  const fileID = objects.isDefined(params.fileID) ? params.fileID : 0;
  const file = dir + "/not-following-back." + fileID + ".json";
  if (!files.existsSync(file)) return file;
  return await getNextNotFollowingBackFile({
    dir,
    fileID: fileID + 1,
  });
}

const getNotFollowingBack = (params) => async (friendships) => {
  try {
    const { dir, screenName } = params;
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
      await getNextNotFollowingBackFile({ dir }),
      json.stringify(notFollowingBack, null, "\t"),
      "utf8"
    );
    return notFollowingBack;
  } catch (e) {
    throw new RethrownError(e);
  }
};

async function getScreenNamesToFollow(params) {
  try {
    const { client, dir, maxID, numToFollow, query, screenName } = params;
    const requestNum = objects.isDefined(params.requestNum)
      ? params.requestNum
      : 0;
    const screenNamesToFollow = params.screenNamesToFollow
      ? params.screenNamesToFollow
      : [];
    // search/tweets is rate limited. Twitter allows 100 requests per 15-minute
    // window when using user authentication.
    const recentTweets = await searchRecentTweets({
      client,
      dir,
      maxID,
      query,
      screenName,
    });
    const screenNames = [
      ...new Set(
        screenNamesToFollow.concat(
          await filterRecentTweets({
            dir,
            recentTweets,
            screenName,
          })
        )
      ),
    ];
    console.log(
      (requestNum === 0 ? "We" : "Cumulatively we have") +
        " found " +
        screenNames.length +
        " unique screen names."
    );
    // 100 requests / 15 minutes ≈ 6.66666666667 requests / minute
    const maxRequestNum = 6;
    if (
      recentTweets.length === 0 ||
      requestNum >= maxRequestNum ||
      screenNames.length >= numToFollow
    )
      return screenNames;
    // 15 minutes / 100 requests * 60 seconds / 1 minute * 1000 milliseconds / 1 second
    // = 9000 milliseconds / request
    console.log(
      "Making another request (" +
        (requestNum + 2) +
        " of " +
        (maxRequestNum + 1) +
        " max)..."
    );
    await timers.setTimeoutPromise(9000); // milliseconds
    return await getScreenNamesToFollow({
      client,
      dir,
      maxID: recentTweets[recentTweets.length - 1].id,
      numToFollow,
      query,
      requestNum: requestNum + 1,
      screenName,
      screenNamesToFollow: screenNames,
    });
  } catch (e) {
    throw new RethrownError(e);
  }
}

async function listFriendsScreenNames(params) {
  try {
    const { client, dir, screenName } = params;
    const cursor = objects.isDefined(params.cursor) ? params.cursor : -1;
    const friendsScreenNames = params.friendsScreenNames
      ? params.friendsScreenNames
      : [];
    const requestNum = objects.isDefined(params.requestNum)
      ? params.requestNum
      : 0;
    if (requestNum === 0) console.log("Making a friends/list request...");
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
    // friends/list is rate limited. Twitter allows 15 requests per 15-minute window
    // when using user authentication.
    console.log("Waiting 1 minute to make another friends/list request...");
    await timers.setTimeoutPromise(60000); // milliseconds = 1 minute
    return await listFriendsScreenNames({
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
    throw new RethrownError(e);
  }
}

const lookUpFriendships = (params) => async (friendsScreenNames) => {
  try {
    const { client, dir, screenName } = params;
    const friendships = params.friendships ? params.friendships : [];
    const i = objects.isDefined(params.i) ? params.i : 0;
    const requestNum = objects.isDefined(params.requestNum)
      ? params.requestNum
      : 0;
    if (i >= friendsScreenNames.length) return friendships;
    if (i === 0) console.log("Making a friendships/lookup request...");
    else {
      // friendships/lookup is rate limited. Twitter allows 15 requests per 15-minute
      // window when using user authentication.
      console.log(
        "Waiting 1 minute to make another friendships/lookup request..."
      );
      await timers.setTimeoutPromise(60000); // milliseconds = 1 minute
    }
    const friendsScreenNamesSubset = friendsScreenNames.slice(i, i + 100);
    // https://developer.twitter.com/en/docs/twitter-api/v1/accounts-and-users/follow-search-get-users/api-reference/get-friendships-lookup
    const jsonObj = await promises.callCallback(
      client,
      client.get,
      "friendships/lookup",
      {
        screen_name: friendsScreenNamesSubset.join(","),
      }
    );
    await files.writeFile(
      dir + "/friendships." + requestNum + ".json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
    return await lookUpFriendships({
      client,
      dir,
      friendships: friendships.concat(jsonObj[0]),
      i: i + 100,
      requestNum: requestNum + 1,
      screenName,
    })(friendsScreenNames);
  } catch (e) {
    throw new RethrownError(e);
  }
};

async function readFriendsScreeNames(params) {
  try {
    const { dir, screenName } = params;
    const friendsScreenNames = params.friendsScreenNames
      ? params.friendsScreenNames
      : [];
    const jsonNum = objects.isDefined(params.jsonNum) ? params.jsonNum : 0;
    const file = dir + "/friends." + jsonNum + ".json";
    if (!files.existsSync(file)) return friendsScreenNames;
    const jsonStr = await files.readFile(file, "utf8");
    const jsonObj = json.parse(jsonStr);
    return await readFriendsScreeNames({
      dir,
      friendsScreenNames: friendsScreenNames.concat(
        jsonObj[0].users.map((x) => x.screen_name)
      ),
      jsonNum: jsonNum + 1,
      screenName,
    });
  } catch (e) {
    throw new RethrownError(e);
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
    const fileID = objects.isDefined(params.fileID) ? params.fileID : 0;
    const result = params.result ? params.result : [];
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
    throw new RethrownError(e);
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
    throw new RethrownError(e);
  }
}

async function searchRecentTweets(params) {
  try {
    const { client, dir, maxID, query, screenName } = params;
    // https://developer.twitter.com/en/docs/twitter-api/v1/tweets/search/api-reference/get-search-tweets
    const jsonObj = await promises.callCallback(
      client,
      client.get,
      "search/tweets",
      objects.merge(
        {
          count: 100,
          include_entities: false,
          q: query,
          result_type: "recent",
        },
        objects.isDefined(maxID) ? { max_id: maxID } : {}
      )
    );
    await files.mkdirp(dir);
    await files.writeFile(
      dir + "/search-tweets.json",
      json.stringify(jsonObj, null, "\t"),
      "utf8"
    );
    return jsonObj[0].statuses;
  } catch (e) {
    throw new RethrownError(e);
  }
}

const unfollowNotFollowingBack = (params) => async (notFollowingBack) => {
  try {
    const { client, dir, screenName } = params;
    // Map the list of users to a list of Promises.
    await notFollowingBack
      .map((user, index, array) => async () => {
        if (index !== 0)
          // friendships/destroy is rate limited, but the rate is not defined in the docs.
          // Let's use 10 seconds.
          await timers.setTimeoutPromise(10000); // milliseconds = 10 seconds
        console.log(
          "Unfollowing " +
            (index + 1) +
            " of " +
            array.length +
            ": " +
            user.screen_name +
            " (#" +
            user.ordinal +
            ")..."
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
      })
      // Execute each Promise one after the other.
      .reduce(
        (accumulator, currentValue) => accumulator.then(currentValue),
        Promise.resolve()
      );
  } catch (e) {
    throw new RethrownError(e);
  }
};
