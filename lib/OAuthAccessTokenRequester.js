"use strict";

const errors = require("@util.js/errors"),
  { OAuth } = require("oauth"),
  Privates = require("@util.js/privates"),
  promises = require("@util.js/promises"),
  { RethrownError } = errors;

const privates = new Privates();

// https://developer.twitter.com/en/docs/authentication/oauth-1-0a/obtaining-user-access-tokens
module.exports = class OAuthAccessTokenRequester {
  constructor(options) {
    privates.setProps(this, options);
    const thiz = privates.getProps(this);
  }

  requestOAuthAccessToken() {
    const thiz = privates.getProps(this);
    return errors.catch(requestOAuthAccessTokensInternal(thiz)).finally(() => {
      process.stdin.unref();
    });
  }
};

async function requestOAuthAccessTokensInternal(thiz) {
  try {
    console.log("What is your consumer key?");
    const consumerKey = await once(thiz);

    console.log("What is your consumer secret?");
    const consumerSecret = await once(thiz);

    const consumer = new OAuth(
      thiz.requestTokenUrl,
      thiz.accessTokenUrl,
      consumerKey,
      consumerSecret,
      "1.0A",
      "",
      "HMAC-SHA1"
    );

    const oauthTokens = await promises.callCallback(
      consumer,
      consumer.getOAuthRequestToken
    );
    const oauthToken = oauthTokens[0];
    const oauthTokenSecret = oauthTokens[1];

    console.log("Paste the following into a browser and allow access.");
    console.log(thiz.authorizeUrl + "?oauth_token=" + oauthToken);
    console.log("From the redirected URL, what is the OAuth verifier?");

    const oauthVerifier = await once(thiz);

    const accessTokens = await promises.callCallback(
      consumer,
      consumer.getOAuthAccessToken,
      oauthToken,
      oauthTokenSecret,
      oauthVerifier
    );
    const accessTokenKey = accessTokens[0];
    const accessTokenSecret = accessTokens[1];

    return {
      consumer_key: consumerKey,
      consumer_secret: consumerSecret,
      oauth_token: oauthToken,
      oauth_token_secret: oauthTokenSecret,
      oauth_verifier: oauthVerifier,
      access_token_key: accessTokenKey,
      access_token_secret: accessTokenSecret,
    };
  } catch (e) {
    throw new RethrownError(e);
  }
}

function once(thiz) {
  return new Promise((resolve, reject) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}
