const mysql = require("mysql2/promise");
require("dotenv").config({ path: require('node:path').join(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false,
  },
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,
  timezone: "+08:00",
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'", () => {
    // ignore session timezone set errors; app still works with pool-level timezone
  });
});

require('../utils/databaseAudit').installDatabaseAudit(pool);
module.exports = pool;

