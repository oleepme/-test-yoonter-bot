// src/db.js
const { Pool } = require("pg");
const crypto = require("crypto");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing env: DATABASE_URL");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function initDb() {
  // ==========================
  // parties (기존)
  // ==========================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parties (
      message_id  TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      guild_id    TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      party_note  TEXT DEFAULT '',
      mode        TEXT NOT NULL,
      start_at    BIGINT NOT NULL,
      status      TEXT NOT NULL,
      max_players INT  NOT NULL DEFAULT 4,
      time_text   TEXT DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_members (
      message_id    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      display_name  TEXT DEFAULT '',
      note          TEXT DEFAULT '',
      joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );
  `);

  await pool.query(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS time_text TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE party_members ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT '';`);

  // ==========================
  // 입퇴장 시스템 (기존)
  // ==========================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_profiles (
      guild_id           TEXT NOT NULL,
      user_id            TEXT NOT NULL,
      last_display_name  TEXT NOT NULL DEFAULT '',
      last_username      TEXT NOT NULL DEFAULT '',
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);
  await pool.query(`ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS last_username TEXT NOT NULL DEFAULT '';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS active_member_slots (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      slot_no    INT  NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_member_slots_guild_slot
    ON active_member_slots(guild_id, slot_no);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS welcome_messages (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_log_messages (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      kind       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_member_log_messages_lookup
    ON member_log_messages(guild_id, user_id, created_at DESC);
  `);

  // ==========================
  // 카카오 입/퇴장 기록
  // ==========================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kakao_events (
      id         BIGSERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      date_key   TEXT NOT NULL,
      time_24    TEXT NOT NULL,
      event_type TEXT NOT NULL,
      kakao_name TEXT NOT NULL,
      raw_line   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      posted_at  TIMESTAMPTZ,
      event_hash TEXT
    );
  `);

  await pool.query(`ALTER TABLE kakao_events ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kakao_events ADD COLUMN IF NOT EXISTS event_hash TEXT;`);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_kakao_events_hash_v2
    ON kakao_events(guild_id, event_hash)
    WHERE event_hash IS NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_kakao_events_guild_date
    ON kakao_events(guild_id, date_key, time_24);
  `);
}

// --------------------
// party 기능
// --------------------
async function upsertParty(party) {
  const {
    message_id, channel_id, guild_id, owner_id, kind, title,
    party_note = "", mode = "TEXT", start_at = 0, status = "RECRUIT",
    max_players = 4, time_text = "",
  } = party;

  await pool.query(
    `
    INSERT INTO parties (message_id, channel_id, guild_id, owner_id, kind, title, party_note, mode, start_at, status, max_players, time_text)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (message_id) DO UPDATE SET
      channel_id   = EXCLUDED.channel_id,
      guild_id     = EXCLUDED.guild_id,
      owner_id     = EXCLUDED.owner_id,
      kind         = EXCLUDED.kind,
      title        = EXCLUDED.title,
      party_note   = EXCLUDED.party_note,
      mode         = EXCLUDED.mode,
      start_at     = EXCLUDED.start_at,
      status       = EXCLUDED.status,
      max_players  = EXCLUDED.max_players,
      time_text    = EXCLUDED.time_text
    `,
    [message_id, channel_id, guild_id, owner_id, kind, title, party_note, mode, start_at, status, max_players, time_text]
  );
}

async function setMemberNote(messageId, userId, displayName, note = "") {
  await pool.query(
    `
    INSERT INTO party_members (message_id, user_id, display_name, note)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (message_id, user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      note         = EXCLUDED.note
    `,
    [messageId, userId, (displayName ?? "").toString(), note]
  );
}

async function removeMember(messageId, userId) {
  await pool.query(`DELETE FROM party_members WHERE message_id=$1 AND user_id=$2`, [messageId, userId]);
}

async function deleteParty(messageId) {
  await pool.query(`DELETE FROM party_members WHERE message_id=$1`, [messageId]);
  await pool.query(`DELETE FROM parties WHERE message_id=$1`, [messageId]);
}

async function getParty(messageId) {
  const p = await pool.query(`SELECT * FROM parties WHERE message_id=$1`, [messageId]);
  if (!p.rows.length) return null;

  const m = await pool.query(
    `SELECT user_id, display_name, note FROM party_members WHERE message_id=$1 ORDER BY joined_at ASC`,
    [messageId]
  );

  return { ...p.rows[0], members: m.rows };
}

// --------------------
// kakao 기능
// --------------------
async function insertKakaoEvents(events) {
  if (!events?.length) return { insertedRows: [], insertedCount: 0 };

  const insertedRows = [];

  for (const e of events) {
    const guild_id = (e.guild_id ?? "").toString();
    const date_key = (e.date_key ?? "UNKNOWN").toString();
    const time_24 = (e.time_24 ?? "??:??").toString();
    const event_type = (e.event_type ?? "").toString();
    const kakao_name = (e.kakao_name ?? "").toString();
    const raw_line = (e.raw_line ?? "").toString();

    if (!guild_id || !event_type || !kakao_name || !raw_line) continue;

    const event_hash = sha1([date_key, time_24, event_type, kakao_name, raw_line].join("|"));

    try {
      const r = await pool.query(
        `
        INSERT INTO kakao_events (guild_id, date_key, time_24, event_type, kakao_name, raw_line, event_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, guild_id, date_key, time_24, event_type, kakao_name, raw_line
        `,
        [guild_id, date_key, time_24, event_type, kakao_name, raw_line, event_hash]
      );
      if (r.rows?.length) insertedRows.push(r.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        continue;
      }
      console.error("Insert Error:", err);
    }
  }

  return { insertedRows, insertedCount: insertedRows.length };
}

async function markKakaoEventsPosted(ids) {
  if (!ids?.length) return;
  await pool.query(
    `UPDATE kakao_events SET posted_at = NOW() WHERE id = ANY($1::bigint[])`,
    [ids]
  );
}

async function getRecentKakaoEvents(days) {
  const d = Number(days) || 30;
  const r = await pool.query(
    `
    SELECT id, guild_id, date_key, time_24, event_type, kakao_name, raw_line
    FROM kakao_events
    WHERE 
      date_key = 'UNKNOWN'
      OR (date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (date_key::date >= (NOW()::date - ($1::int || ' days')::interval)))
    ORDER BY
      CASE WHEN date_key = 'UNKNOWN' THEN 1 ELSE 0 END,
      date_key ASC,
      time_24 ASC,
      id ASC
    `,
    [d]
  );
  return r.rows ?? [];
}

async function getKakaoEventsRange(guildId, days) {
  const d = Number(days) || 30;

  const r = await pool.query(
    `
    SELECT id, guild_id, date_key, time_24, event_type, kakao_name, raw_line
    FROM kakao_events
    WHERE guild_id = $1
      AND (
        date_key = 'UNKNOWN'
        OR (
          date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND date_key::date >= (NOW()::date - ($2::int || ' days')::interval)
        )
      )
    ORDER BY
      CASE WHEN date_key = 'UNKNOWN' THEN 1 ELSE 0 END,
      date_key ASC,
      time_24 ASC,
      id ASC
    `,
    [guildId, d]
  );

  return r.rows ?? [];
}

async function clearKakaoEvents(guildId, days) {
  const d = Number(days) || 1;

  const r = await pool.query(
    `
    DELETE FROM kakao_events
    WHERE guild_id = $1
      AND (
        date_key = 'UNKNOWN'
        OR (
          date_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND date_key::date >= (NOW()::date - ($2::int || ' days')::interval)
        )
      )
    `,
    [guildId, d]
  );

  return r.rowCount ?? 0;
}

module.exports = {
  initDb,
  upsertParty,
  setMemberNote,
  removeMember,
  deleteParty,
  getParty,
  insertKakaoEvents,
  markKakaoEventsPosted,
  getRecentKakaoEvents,
  getKakaoEventsRange,
  clearKakaoEvents,
};