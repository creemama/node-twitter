# @util.js/node-twitter

> A Twitter command-line-interface (CLI)

<p>
  <a href="https://www.npmjs.com/package/@util.js/node-twitter"><img alt="NPM Status" src="https://img.shields.io/npm/v/@util.js/node-twitter.svg?style=flat"></a>
  <a href="https://github.com/prettier/prettier"><img alt="Code Style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square"></a>
</p>

```
npm install --global @util.js/node-twitter

# Output help.
node-twitter

# Authorize node-twitter to access screen-name's tweets using your Twitter
# developer account.
node-twitter screen-name authorize

# Follow 10 unique users, where their number of followers is greater than the
# number they are following, querying tweets with the hashtag #javascript.
node-twitter screen-name follow 10 "#javascript"

# Unfollow all users not following screen-name back.
node-twitter screen-name unfollow
```

[comment]: # "Update outputHelp in NodeTwitterMain if you update "
[comment]: # "node-twitter's usage here."

## Repository Maintenance Commands

- Work within a Docker container: `./dev.sh docker`
- Run from a Docker container: `./dev.sh docker -c "npm link && node-twitter"`
- Create standalone binaries: `./dev.sh docker-pkg`
- Format the project: `./dev.sh docker-format`
- Update dependencies: `./dev.sh docker-update`
- Deploy: `./dev.sh docker-deploy`
