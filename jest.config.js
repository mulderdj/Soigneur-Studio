module.exports = {
    "setupFiles": [
        "<rootDir>/test/jest-setup.js"
    ],
    // server/*.spec.mjs are node:test files, run with `npm run test:server`
    "testPathIgnorePatterns": [
        "/node_modules/",
        "<rootDir>/server/"
    ],
    "transform": {
        "^.+\\.js$": "babel-jest"
    }
};
