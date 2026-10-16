async function nextUserId(conn) {
 const [rows] = await conn.query("SELECT NextValue FROM UserIdSequence WHERE SequenceID=1 FOR UPDATE");
 if (!rows[0]) throw new Error('Run the users audit migration before creating users.');
 const value = Number(rows[0].NextValue);
 await conn.query("UPDATE UserIdSequence SET NextValue=NextValue+1 WHERE SequenceID=1");
 return `U-${String(value).padStart(3,'0')}`;
}
module.exports = {nextUserId};
