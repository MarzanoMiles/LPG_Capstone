const {restoreSnapshot} = require('./currentSnapshot');
if (require.main === module) restoreSnapshot()
  .then(message => console.log(message))
  .catch(error => { console.error(error.message); process.exitCode=1; })
module.exports = restoreSnapshot;
