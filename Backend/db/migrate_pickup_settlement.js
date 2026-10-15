const fs=require("fs");
const path=require("path");
const pool=require("../config/db");
async function migrate() {
 await require("./migrate_pickup_stage1")();
 await pool.query(fs.readFileSync(path.join(__dirname,"patch_pickup_settlement.sql"),"utf8"));
 console.log("Pickup settlement schema ready.");
}
if(require.main===module) migrate().catch(err=>{console.error(err.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
