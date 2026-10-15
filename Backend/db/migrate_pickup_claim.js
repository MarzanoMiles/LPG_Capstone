const pool=require("../config/db");
const fs=require("fs");
const path=require("path");
async function migrate(){
 await require("./migrate_pickup_settlement")();
 await pool.query(fs.readFileSync(path.join(__dirname,"patch_pickup_claim.sql"),"utf8"));
 const [rows]=await pool.query("SELECT PickupScheduledAt, PickupStatus, PickupSettlementPending FROM `Order` LIMIT 1");
 console.log("Pickup claim schema ready; pickup columns verified. Sample rows:",rows.length);
}
if(require.main===module)migrate().catch(err=>{console.error(err.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
