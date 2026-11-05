const crypto = require("crypto");

function verifyRetellSignature(rawBody, signature, apiKey) {
  if (!rawBody || !signature || !apiKey) return false;
  const match = /^v=(\d+),d=([a-f0-9]+)$/i.exec(signature);
  if (!match || Math.abs(Date.now() - Number(match[1])) > 5 * 60 * 1000) return false;
  const expected = crypto.createHmac("sha256", apiKey).update(rawBody + match[1]).digest("hex");
  const supplied = Buffer.from(match[2].toLowerCase(), "hex");
  const calculated = Buffer.from(expected, "hex");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}

async function saveRetellEvent(pool, payload) {
  const call = payload.call || {};
  if (!call.call_id || !call.agent_id) return false;
  const owner = await pool.query(
    "SELECT clerk_user_id FROM business_profiles WHERE retell_agent_id=$1 LIMIT 1",
    [call.agent_id]
  );
  if (!owner.rowCount) return false;
  await pool.query(
    "INSERT INTO retell_calls(call_id,clerk_user_id,agent_id,event,call_status,from_number,to_number,transcript,recording_url,duration_ms,start_timestamp,end_timestamp,call_analysis,call_cost,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,NOW()) ON CONFLICT(call_id) DO UPDATE SET event=EXCLUDED.event,call_status=COALESCE(EXCLUDED.call_status,retell_calls.call_status),from_number=COALESCE(EXCLUDED.from_number,retell_calls.from_number),to_number=COALESCE(EXCLUDED.to_number,retell_calls.to_number),start_timestamp=COALESCE(EXCLUDED.start_timestamp,retell_calls.start_timestamp),end_timestamp=COALESCE(EXCLUDED.end_timestamp,retell_calls.end_timestamp),transcript=COALESCE(EXCLUDED.transcript,retell_calls.transcript),recording_url=COALESCE(EXCLUDED.recording_url,retell_calls.recording_url),duration_ms=COALESCE(EXCLUDED.duration_ms,retell_calls.duration_ms),call_analysis=COALESCE(EXCLUDED.call_analysis,retell_calls.call_analysis),call_cost=COALESCE(EXCLUDED.call_cost,retell_calls.call_cost),updated_at=NOW()",
    [call.call_id, owner.rows[0].clerk_user_id, call.agent_id, String(payload.event || "unknown"),
      call.call_status || null, call.from_number || null, call.to_number || null, call.transcript || null,
      call.recording_url || null, Number.isFinite(call.duration_ms) ? call.duration_ms : null,
      call.start_timestamp || null, call.end_timestamp || null,
      call.call_analysis ? JSON.stringify(call.call_analysis) : null,
      call.call_cost ? JSON.stringify(call.call_cost) : null]
  );
  return true;
}

module.exports = { verifyRetellSignature, saveRetellEvent };
