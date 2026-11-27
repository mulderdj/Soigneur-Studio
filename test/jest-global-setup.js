// The tests were written for Europe/Helsinki (see test/utils.test.js); pin it so
// they pass on any machine, including CI (UTC).
module.exports = async () => {
    process.env.TZ = 'Europe/Helsinki';
};
