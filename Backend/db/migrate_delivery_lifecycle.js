const pool = require('../config/db');
async function migrate() {
  const [columns] = await pool.query('SHOW COLUMNS FROM Delivery');
  for (const [name, type] of Object.entries({PaymentMethod:'VARCHAR(30) NULL',AttemptCount:'INT UNSIGNED NOT NULL DEFAULT 0',NextAttemptAt:'DATETIME NULL',RestockedAt:'DATETIME NULL',SettledAt:'DATETIME NULL'})) {
    if (!columns.some(c => c.Field === name)) await pool.query(`ALTER TABLE Delivery ADD COLUMN ${name} ${type}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS DeliveryAction (
    DeliveryID VARCHAR(20) NOT NULL, RequestID VARCHAR(64) NOT NULL, RequestHash CHAR(64) NOT NULL,
    UserID VARCHAR(20) NOT NULL, Action VARCHAR(30) NOT NULL, Details JSON NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(DeliveryID,RequestID),
    FOREIGN KEY(DeliveryID) REFERENCES Delivery(DeliveryID))`);
  await pool.query("UPDATE Delivery SET DeliveryStatus='Preparing' WHERE DeliveryStatus='Pending'");
  await pool.query("UPDATE Delivery SET DeliveryStatus='Failed Attempt' WHERE DeliveryStatus='Failed'");
  // Existing payment rows are evidence of the selected method; never infer a paid balance.
  await pool.query(`UPDATE Delivery d JOIN (
    SELECT SaleID,MAX(PaymentMethod) AS method FROM Payment WHERE PaymentType='Sale'
    GROUP BY SaleID HAVING COUNT(DISTINCT PaymentMethod)=1
  ) p ON p.SaleID=d.SaleID SET d.PaymentMethod=p.method WHERE d.PaymentMethod IS NULL`);
  const [numbers]=await pool.query('SELECT DeliveryID,DRNo FROM Delivery ORDER BY DRNo');
  const used=new Set(numbers.map(row=>row.DRNo));
  for(const row of numbers) {
    const match=/^DR-(\d{4})-(\d+)$/.exec(row.DRNo);
    if(!match)continue;
    let serial=Number(match[2]),number;
    do {number=`DEL-${match[1]}-${String(serial++).padStart(3,'0')}`;} while(used.has(number));
    await pool.query('UPDATE Delivery SET DRNo=:number WHERE DeliveryID=:id',{number,id:row.DeliveryID});
    used.add(number);
  }
}
if (require.main === module) migrate().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
