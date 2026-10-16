const pool = require("../config/db");

async function logUserActivity(
  {
    userId,
    activityType,
    module,
    recordId = null,
    description = null,
    outcome = "Success",
  },
  conn = pool
) {
  if (!userId || !activityType || !module) return;

  const userActivityId = `AUD-${require("crypto").randomBytes(8).toString("hex")}`;
  await conn.query(
    `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description, Outcome)
     VALUES (:userActivityId, :userId, :activityType, :module, :recordId, :description, :outcome)`,
    { userActivityId, userId, activityType, module, recordId, description, outcome }
  );
}

module.exports = {
  logUserActivity,
};

