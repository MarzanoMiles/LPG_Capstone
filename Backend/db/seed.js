// Current seed entry point: never drops tables or creates demo business records.
const pool = require('../config/db');
const {seedSystemRoles} = require('./seedSystemRoles');
if (require.main === module) seedSystemRoles(pool)
  .then(message => console.log(message))
  .catch(error => { console.error(error.message); process.exitCode=1; })
  .finally(() => pool.end());
module.exports = () => seedSystemRoles(pool);
