module.exports = {
    "globalSetup": "<rootDir>/test/jest-global-setup.js",
    "setupFiles": [
        "<rootDir>/test/jest-setup.js"
    ],
    // server/*.spec.mjs are node:test files, run with `npm run test:server`
    "testPathIgnorePatterns": [
        "/node_modules/",
        "<rootDir>/server/",
        "<rootDir>/test/visual/"
    ],
    "transform": {
        "^.+\\.js$": ["babel-jest", {
            "plugins": ["@babel/plugin-transform-modules-commonjs"]
        }]
    },
    "transformIgnorePatterns": [
        "/node_modules/(?!(@material/material-color-utilities|@garmin/fitsdk|web-ant-plus)/)"
    ]
};
