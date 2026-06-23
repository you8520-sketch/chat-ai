import "server-only";

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getDataDir, getDatabasePath } from "@/lib/dataDir";
import { seedGlobalLorebookEntries } from "@/lib/globalLorebook";
import { backfillCharacterEngagementStats } from "@/lib/characterEngagementStats";

const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

function init(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    is_adult INTEGER NOT NULL DEFAULT 0,
    nsfw_on INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 1000,
    sub_until TEXT,
    google_id TEXT,
    pref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    greeting TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '일상',
    tags TEXT NOT NULL DEFAULT '[]',
    nsfw INTEGER NOT NULL DEFAULT 0,
    official INTEGER NOT NULL DEFAULT 0,
    emoji TEXT NOT NULL DEFAULT '✨',
    hue INTEGER NOT NULL DEFAULT 260,
    creator_id INTEGER,
    creator_name TEXT NOT NULL DEFAULT '운영팀',
    likes INTEGER NOT NULL DEFAULT 0,
    chats_count INTEGER NOT NULL DEFAULT 0,
    audience TEXT NOT NULL DEFAULT 'all',
    world TEXT NOT NULL DEFAULT '',
    example_dialog TEXT NOT NULL DEFAULT '',
    images TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, character_id)
  );
  CREATE TABLE IF NOT EXISTS follows (
    user_id INTEGER NOT NULL,
    creator_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, creator_id)
  );
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'safe',
    memory TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS party_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    character_id INTEGER NOT NULL,
    owner_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'safe',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS party_members (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS party_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER,
    nickname TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '익명',
    author_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);
  migrate(db);
  seed(db);
}

// 기존 DB에 새 컬럼 추가 (이미 있으면 무시)
function migrate(db: Database.Database) {
  const addColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  addColumn("users", "google_id", "TEXT");
  addColumn("users", "pref", "TEXT");
  addColumn("users", "sub_until", "TEXT");
  addColumn("users", "sub_plan", "TEXT");
  addColumn("users", "sub_auto_renew", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "notice_last_read_id", "INTEGER NOT NULL DEFAULT 0");
  addColumn("characters", "audience", "TEXT NOT NULL DEFAULT 'all'");
  addColumn("characters", "gender", "TEXT NOT NULL DEFAULT 'other'");
  addColumn("users", "persona_name", "TEXT NOT NULL DEFAULT ''");
  addColumn("users", "persona_bio", "TEXT NOT NULL DEFAULT ''");
  addColumn("users", "user_note", "TEXT NOT NULL DEFAULT ''");
  addColumn("users", "chat_prefs", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "gemini_model", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "persona_bio", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "user_note", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "world", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "example_dialog", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "images", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "setting_chunks", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "speech_profile", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "assets", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "visibility", "TEXT NOT NULL DEFAULT 'public'");
  addColumn("characters", "moderation_status", "TEXT NOT NULL DEFAULT 'approved'");
  addColumn("characters", "moderation_note", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "share_slug", "TEXT");
  addColumn("characters", "genres", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "world_id", "INTEGER");
  addColumn("characters", "lorebook_id", "INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_turn_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      assistant_message_id INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(chat_id, turn_number)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_turn_summaries_chat
      ON chat_turn_summaries(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chat_turn_summaries_message
      ON chat_turn_summaries(assistant_message_id);
  `);
  db.exec(`UPDATE characters SET visibility='public', moderation_status='approved' WHERE official=1 OR creator_id IS NULL`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_worlds_creator ON worlds(creator_id, updated_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS keyword_lorebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      entries_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_keyword_lorebooks_creator ON keyword_lorebooks(creator_id, updated_at);
  `);
  addColumn("chats", "memory_pending", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("chats", "memory_meta", "TEXT NOT NULL DEFAULT '{}'");
  addColumn("chats", "memory_archived_turns", "INTEGER NOT NULL DEFAULT 0");
  addColumn("chats", "selected_persona_id", "INTEGER");
  addColumn("chats", "user_impersonation", "INTEGER NOT NULL DEFAULT 0");
  addColumn("chats", "target_response_chars", "INTEGER NOT NULL DEFAULT 2000");
  addColumn("characters", "recommended_writing_style", "TEXT NOT NULL DEFAULT 'balanced'");
  addColumn("chats", "writing_style_override", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "title", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "current_summary", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "memory_capacity", "INTEGER NOT NULL DEFAULT 7000");
  addColumn("chats", "status_window_enabled", "INTEGER NOT NULL DEFAULT 0");
  addColumn("characters", "status_widget_json", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "status_widget_allow_user_override", "INTEGER NOT NULL DEFAULT 1");
  addColumn("chats", "status_widget_mode", "TEXT NOT NULL DEFAULT 'character_only'");
  addColumn("chats", "user_status_widget_json", "TEXT NOT NULL DEFAULT ''");
  addColumn("chats", "status_widget_stack_order", "TEXT NOT NULL DEFAULT 'character_first'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_id)
    );
  `);
  addColumn("bookmarks", "title", "TEXT NOT NULL DEFAULT ''");
  addColumn("messages", "status_widget_values_json", "TEXT NOT NULL DEFAULT ''");
  addColumn("messages", "status_widget_turn_active", "INTEGER NOT NULL DEFAULT 0");
  addColumn("messages", "usage", "TEXT");
  addColumn("messages", "status", "TEXT NOT NULL DEFAULT 'ok'");
  addColumn("messages", "is_refunded", "INTEGER NOT NULL DEFAULT 0");
  addColumn("messages", "deduction_slices", "TEXT");
  addColumn("point_logs", "message_id", "INTEGER");
  addColumn("point_logs", "chat_id", "INTEGER");
  addColumn("messages", "alternates", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("messages", "active_variant", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "creator_points", "REAL NOT NULL DEFAULT 0");
  addColumn("users", "real_name", "TEXT NOT NULL DEFAULT ''");
  addColumn("users", "resident_id", "TEXT NOT NULL DEFAULT ''");
  addColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "creator_exclusive", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "partner_tier_granted_at", "TEXT");
  addColumn("users", "partner_tier_valid_until", "TEXT");
  addColumn("users", "last_attendance_date", "TEXT");
  migrateWithdrawalRequestsQueue(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL UNIQUE,
      consumer_user_id INTEGER NOT NULL,
      points_spent REAL NOT NULL,
      reward_amount REAL NOT NULL,
      reversed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator
      ON creator_earnings(creator_id, created_at);
    CREATE TABLE IF NOT EXISTS creator_point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS creator_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      cp_amount REAL NOT NULL,
      fee_amount REAL NOT NULL,
      net_krw INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      account_number_masked TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
      admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_creator_withdrawals_user
      ON creator_withdrawals(user_id, created_at);
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requested_cp REAL NOT NULL,
      tax_amount REAL NOT NULL,
      platform_fee REAL NOT NULL,
      payout_amount INTEGER NOT NULL,
      account_info TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','FAILED')),
      failure_reason TEXT NOT NULL DEFAULT '',
      provider_ref TEXT NOT NULL DEFAULT '',
      resident_number TEXT NOT NULL DEFAULT '',
      id_card_url TEXT NOT NULL DEFAULT '',
      bankbook_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user
      ON withdrawal_requests(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
      ON withdrawal_requests(status, created_at);
  `);
  migrateWithdrawalRequestsQueue(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      refund_amount REAL NOT NULL DEFAULT 0,
      validation_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_report_refunds_user_day
      ON report_refunds(user_id, created_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addColumn("user_personas", "memo", "TEXT NOT NULL DEFAULT ''");
  addColumn("user_personas", "gender", "TEXT NOT NULL DEFAULT 'other'");
  addColumn("user_personas", "speech_examples", "TEXT NOT NULL DEFAULT ''");
  migrateLegacyPersonas(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_note_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_note_presets_user
      ON user_note_presets(user_id, created_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_status_widget_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      widget_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_status_widget_presets_user
      ON user_status_widget_presets(user_id, created_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_widget_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      share_slug TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      widget_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_status_widget_shares_slug
      ON status_widget_shares(share_slug);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL CHECK(point_type IN ('PAID', 'FREE')),
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_point_tx_user_exp
      ON point_transactions(user_id, point_type, expires_at);
  `);
  migratePointsLedger(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL DEFAULT '익명',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      message_id INTEGER,
      content TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    "DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board='faq' AND title != '캐릭터 제작은 누구나 가능한가요?')"
  ).run();
  db.prepare(
    "DELETE FROM posts WHERE board='faq' AND title != '캐릭터 제작은 누구나 가능한가요?'"
  ).run();
  const charCreateFaq = db
    .prepare("SELECT id FROM posts WHERE board='faq' AND title='캐릭터 제작은 누구나 가능한가요?'")
    .get() as { id: number } | undefined;
  if (!charCreateFaq) {
    db.prepare("INSERT INTO posts (board, title, content, author_name) VALUES (?,?,?,?)").run(
      "faq",
      "캐릭터 제작은 누구나 가능한가요?",
      "캐릭터 제작은 성인인증을 완료한 회원만 가능합니다.",
      "운영팀"
    );
  }
  db.prepare(
    "DELETE FROM posts WHERE board='notice' AND title IN ('서비스 오픈 안내', 'NSFW 콘텐츠 이용 안내')"
  ).run();
  const betaNotice = db
    .prepare("SELECT id FROM posts WHERE board='notice' AND title='클로즈베타 테스트중'")
    .get() as { id: number } | undefined;
  if (!betaNotice) {
    db.prepare("INSERT INTO posts (board, title, content, author_name) VALUES (?,?,?,?)").run(
      "notice",
      "클로즈베타 테스트중",
      "클로즈베타 테스트가 진행 중입니다. 메인 화면의 「무료 포인트 신청하기」에서 신청하시면 관리자 검토 후 무료 포인트가 지급됩니다.",
      "운영팀"
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chats_character_created
      ON chats(character_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chats_user_character
      ON chats(user_id, character_id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, character_id)
    );
    CREATE TABLE IF NOT EXISTS memory_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      message_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_buffer_user_char
      ON memory_buffer(user_id, character_id);
    CREATE INDEX IF NOT EXISTS idx_character_memories_user
      ON character_memories(user_id);
    CREATE TABLE IF NOT EXISTS chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_memories_user
      ON chat_memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_memories_character
      ON chat_memories(character_id);
  `);
  addColumn("memory_buffer", "chat_id", "INTEGER");
  addColumn("messages", "user_message_id", "INTEGER");
  addColumn("messages", "status_meta", "TEXT");
  addColumn("users", "training_consent", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      vote INTEGER NOT NULL CHECK(vote IN (1, -1)),
      reasons TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL DEFAULT '',
      variant_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS message_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      variant_index INTEGER NOT NULL DEFAULT 0,
      user_message_id INTEGER,
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT 'safe',
      writing_style TEXT NOT NULL DEFAULT '',
      nsfw INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_hash TEXT NOT NULL DEFAULT '',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_message_generations_message ON message_generations(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_generations_chat ON message_generations(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS preference_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      message_id INTEGER,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_preference_events_user ON preference_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_preference_events_message ON preference_events(message_id);
    CREATE TABLE IF NOT EXISTS message_scores (
      message_id INTEGER PRIMARY KEY,
      quality_score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      continuation_rate REAL NOT NULL DEFAULT 0,
      engagement_score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS training_analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_type TEXT NOT NULL CHECK(run_type IN ('daily_tag', 'weekly_export')),
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
      messages_processed INTEGER NOT NULL DEFAULT 0,
      messages_skipped INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS training_message_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      analysis_run_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.5,
      label TEXT NOT NULL DEFAULT 'neutral',
      source TEXT NOT NULL DEFAULT 'heuristic' CHECK(source IN ('heuristic', 'ai')),
      feedback_fingerprint TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (analysis_run_id) REFERENCES training_analysis_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_training_message_tags_message
      ON training_message_tags(message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_training_message_tags_run
      ON training_message_tags(analysis_run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_training_message_tags_dedup
      ON training_message_tags(message_id, tag, feedback_fingerprint);
  `);
  addColumn("message_scores", "continuation_rate", "REAL NOT NULL DEFAULT 0");
  addColumn("message_scores", "engagement_score", "REAL NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      gross_amount REAL NOT NULL,
      fee_amount REAL NOT NULL,
      net_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_point_gifts_sender
      ON point_gifts(sender_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_point_gifts_recipient
      ON point_gifts(recipient_id, created_at);
  `);
  addColumn("users", "creator_comments_enabled", "INTEGER NOT NULL DEFAULT 1");
  addColumn("characters", "comments_enabled", "INTEGER NOT NULL DEFAULT 1");
  addColumn("characters", "setting_chunks_en", "TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "prompt_translation_hash", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "status_window_prompt", "TEXT NOT NULL DEFAULT ''");
  addColumn("characters", "creator_comment", "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('creator', 'character')),
      target_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL DEFAULT '익명',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_profile_comments_target
      ON profile_comments(target_type, target_id, created_at);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      actor_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user
      ON user_notifications(user_id, read_at, created_at DESC);
  `);
  migrateUserNotificationsExpand(db);
  migrateCharacterAudienceSeed(db);
  migrateLegacyMemoryCapacityDefault(db);
  migrateMemoryCapacityFixed7000(db);
  migrateMemoryCapacityFixed10000(db);
  addColumn("profile_comments", "is_private", "INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "comment_banned", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_lorebook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      triggers_json TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_global_lorebook_entries_depth
      ON global_lorebook_entries(enabled, depth, sort_order);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS create_migration_event_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      admin_note TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cme_user
      ON create_migration_event_applications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cme_status
      ON create_migration_event_applications(status, created_at DESC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS beta_free_point_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reward_amount REAL,
      admin_note TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_beta_free_point_user
      ON beta_free_point_applications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_beta_free_point_status
      ON beta_free_point_applications(status, created_at DESC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS portone_checkouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_id TEXT NOT NULL,
      payment_id TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed')),
      portone_tx_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portone_checkouts_user
      ON portone_checkouts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_portone_checkouts_status
      ON portone_checkouts(status, created_at DESC);
  `);
  addColumn("characters", "total_turns", "INTEGER NOT NULL DEFAULT 0");
  migrateCharacterEngagementStats(db);
  seedGlobalLorebookEntries(db);
}

function migrateCharacterEngagementStats(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(characters)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "total_turns")) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key='engagement_stats_v1'")
    .get() as { value: string } | undefined;
  if (done?.value === "1") return;
  backfillCharacterEngagementStats(db);
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('engagement_stats_v1', '1')").run();
}

/** SQLite DEFAULT 2000 → 앱 기본 4000 (한 번만, 이후 2000은 사용자가 직접 선택한 값) */
function migrateLegacyMemoryCapacityDefault(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const done = db
    .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='memory_capacity_default_4000'")
    .get() as { ok: number } | undefined;
  if (done?.ok) return;
  db.prepare("UPDATE chats SET memory_capacity = 4000 WHERE memory_capacity = 2000").run();
  db.prepare("INSERT INTO _schema_flags (key) VALUES ('memory_capacity_default_4000')").run();
}

function migrateMemoryCapacityFixed7000(db: Database.Database) {
  const done = db
    .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='memory_capacity_fixed_7000'")
    .get() as { ok: number } | undefined;
  if (done?.ok) return;
  db.prepare("UPDATE chats SET memory_capacity = 7000").run();
  db.prepare("INSERT INTO _schema_flags (key) VALUES ('memory_capacity_fixed_7000')").run();
}

function migrateMemoryCapacityFixed10000(db: Database.Database) {
  const done = db
    .prepare("SELECT 1 AS ok FROM _schema_flags WHERE key='memory_capacity_fixed_10000'")
    .get() as { ok: number } | undefined;
  if (done?.ok) return;
  db.prepare("UPDATE chats SET memory_capacity = 10000").run();
  db.prepare("INSERT INTO _schema_flags (key) VALUES ('memory_capacity_fixed_10000')").run();
}

/** 시드·기존 캐릭터 audience 백필 (취향 필터용) */
function migrateCharacterAudienceSeed(db: Database.Database) {
  const seedAudiences: Record<string, "female" | "male"> = {
    "얀데레들 사이에서 바람을 핀다면?": "male",
    히유: "male",
    "밤의 비서실장": "male",
    "저주받은 북부대공": "female",
  };
  const update = db.prepare(
    `UPDATE characters SET audience=? WHERE name=? AND audience='all' AND creator_id IS NULL`
  );
  for (const [name, audience] of Object.entries(seedAudiences)) {
    update.run(audience, name);
  }
}

/** 기존 user_notifications — CHECK/UNIQUE 제거·타입 확장 */
function migrateUserNotificationsExpand(db: Database.Database) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_notifications'")
    .get() as { sql: string } | undefined;
  if (!row?.sql) return;
  const needsMigrate =
    row.sql.includes("UNIQUE(user_id, type, ref_id)") || row.sql.includes("CHECK(type IN");
  if (!needsMigrate) return;
  if (row.sql.includes("user_notifications_mig")) return;
  db.exec(`
      CREATE TABLE user_notifications_mig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        actor_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        read_at TEXT
      );
      INSERT INTO user_notifications_mig
        (id, user_id, type, ref_id, actor_id, title, body, created_at, read_at)
      SELECT id, user_id, type, ref_id, actor_id, title, body, created_at, read_at
      FROM user_notifications;
      DROP TABLE user_notifications;
      ALTER TABLE user_notifications_mig RENAME TO user_notifications;
      CREATE INDEX IF NOT EXISTS idx_user_notifications_user
        ON user_notifications(user_id, read_at, created_at DESC);
    `);
}

function migrateWithdrawalRequestsQueue(db: Database.Database) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='withdrawal_requests'")
    .get();
  if (!table) return;

  const cols = db.prepare("PRAGMA table_info(withdrawal_requests)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));

  if (!names.has("failure_reason")) {
    db.exec("ALTER TABLE withdrawal_requests ADD COLUMN failure_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("provider_ref")) {
    db.exec("ALTER TABLE withdrawal_requests ADD COLUMN provider_ref TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("resident_number")) {
    db.exec("ALTER TABLE withdrawal_requests ADD COLUMN resident_number TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("id_card_url")) {
    db.exec("ALTER TABLE withdrawal_requests ADD COLUMN id_card_url TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("bankbook_url")) {
    db.exec("ALTER TABLE withdrawal_requests ADD COLUMN bankbook_url TEXT NOT NULL DEFAULT ''");
  }

  // SQLite CHECK에 FAILED가 없으면 테이블 재생성
  const ddl = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='withdrawal_requests'")
    .get() as { sql: string } | undefined;
  if (ddl?.sql && !ddl.sql.includes("'FAILED'")) {
    db.exec(`
      CREATE TABLE withdrawal_requests_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        requested_cp REAL NOT NULL,
        tax_amount REAL NOT NULL,
        platform_fee REAL NOT NULL,
        payout_amount INTEGER NOT NULL,
        account_info TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','FAILED')),
        failure_reason TEXT NOT NULL DEFAULT '',
        provider_ref TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed_at TEXT
      );
      INSERT INTO withdrawal_requests_v2
        (id, user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, failure_reason, provider_ref, created_at, processed_at)
      SELECT id, user_id, requested_cp, tax_amount, platform_fee, payout_amount, account_info, status, '', '', created_at, processed_at
      FROM withdrawal_requests;
      DROP TABLE withdrawal_requests;
      ALTER TABLE withdrawal_requests_v2 RENAME TO withdrawal_requests;
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user
        ON withdrawal_requests(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
        ON withdrawal_requests(status, created_at);
    `);
  } else {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
        ON withdrawal_requests(status, created_at);
    `);
  }
}

function migratePointsLedger(db: Database.Database) {
  const users = db.prepare("SELECT id, points FROM users").all() as { id: number; points: number }[];
  const hasTx = db.prepare(
    "SELECT COUNT(*) AS c FROM point_transactions WHERE user_id = ?"
  );
  const insertLegacy = db.prepare(`
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
    VALUES (?, 'PAID', ?, datetime('now', '+5 years'))
  `);
  for (const u of users) {
    const count = (hasTx.get(u.id) as { c: number }).c;
    if (count > 0) continue;
    const amount = Math.round(Number(u.points) * 10) / 10;
    if (amount <= 0) continue;
    insertLegacy.run(u.id, amount);
  }
}

function migrateLegacyPersonas(db: Database.Database) {
  const users = db
    .prepare("SELECT id, nickname, persona_name, persona_bio FROM users")
    .all() as { id: number; nickname: string; persona_name: string; persona_bio: string }[];
  for (const u of users) {
    const count = (db.prepare("SELECT COUNT(*) AS c FROM user_personas WHERE user_id=?").get(u.id) as {
      c: number;
    }).c;
    if (count > 0) continue;
    if (!u.persona_bio?.trim() && !u.persona_name?.trim()) continue;
    const name = (u.persona_name?.trim() || u.nickname || "기본").slice(0, 30);
    const desc = (u.persona_bio ?? "").trim().slice(0, 1000);
    db.prepare("INSERT INTO user_personas (user_id, name, memo, gender, description) VALUES (?,?,?,?,?)").run(
      u.id,
      name,
      "",
      "other",
      desc
    );
  }
}

function seed(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM characters").get() as { c: number }).c;
  if (count > 0) return;

  const ins = db.prepare(`INSERT INTO characters
    (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, emoji, hue, creator_name, likes, chats_count, audience)
    VALUES (@name,@tagline,@description,@greeting,@system_prompt,@genre,@tags,@nsfw,@official,@emoji,@hue,@creator_name,@likes,@chats_count,@audience)`);

  // 시드 캐릭터별 타깃 취향 (male=남성향, female=여성향, all=공용)
  const audienceMap: Record<string, string> = {
    "얀데레들 사이에서 바람을 핀다면?": "male",
    "히유": "male",
    "밤의 비서실장": "male",
    "저주받은 북부대공": "female",
  };

  const chars = [
    {
      name: "얀데레들 사이에서 바람을 핀다면?",
      tagline: "6명의 얀데레, 동시 연애 시뮬레이션!",
      description: "들키면 죽음뿐, 당신의 선택은?",
      greeting: "…오빠, 어디 갔다 왔어? 방금 다른 애 향수 냄새가 났는데. 기분 탓이지?",
      system_prompt: "너는 6명의 얀데레 히로인을 연기한다. user가 바람을 피우는 상황의 스릴 연애 시뮬레이션. 들키면 위험해지는 긴장감을 연출한다.",
      genre: "로맨스", tags: '["여성","로맨스","얀데레"]', nsfw: 1, official: 0, emoji: "🔪", hue: 330, creator_name: "봇마", likes: 30000, chats_count: 175,
    },
    {
      name: "히유",
      tagline: "우리 집 앞 편의점 알바생",
      description: "매일 밤 11시, 편의점 카운터에서 만나는 그녀.",
      greeting: "어서오세요~ 아, 또 오셨네요. 오늘도 삼각김밥이에요?",
      system_prompt: "너는 편의점 알바생 '히유'다. 21살 대학생, 밝고 수줍음이 많다. 단골인 user와 조금씩 가까워진다. 일상적이고 설레는 대화를 한다.",
      genre: "일상", tags: '["추천","여성","일상","힐링"]', nsfw: 0, official: 0, emoji: "🏪", hue: 180, creator_name: "라빈", likes: 2500, chats_count: 6,
    },
    {
      name: "가화만사성",
      tagline: "화목한 가정. 부모님과 4남매.",
      description: "당신은 이들 중 한 사람이 되어 이야기를 진행하실 수 있습니다.",
      greeting: "밥 먹자~! 다들 식탁으로 모여!",
      system_prompt: "너는 화목한 6인 가족 전체를 연기한다. 부모님과 4남매의 일상 코미디. 따뜻하고 웃긴 가족 드라마를 연출한다.",
      genre: "일상", tags: '["추천","가족","힐링","개그"]', nsfw: 0, official: 0, emoji: "🏠", hue: 40, creator_name: "내스티", likes: 5500, chats_count: 25,
    },
    {
      name: "WW2 시뮬레이터",
      tagline: "한 명의 죽음은 비극이요, 백만 명의 죽음은 통계다",
      description: "제2차 세계대전의 한복판에서 당신의 선택이 역사를 바꾼다.",
      greeting: "1939년 9월 1일. 독일군이 폴란드 국경을 넘었다는 소식이 전해진다. 당신의 위치와 신분을 알려달라.",
      system_prompt: "너는 2차 세계대전 시뮬레이션의 게임마스터다. 역사적 사실에 기반해 user의 선택에 따른 전개를 사실적으로 묘사한다.",
      genre: "시뮬", tags: '["대체역사","밀리터리","게임","시뮬"]', nsfw: 0, official: 0, emoji: "🪖", hue: 80, creator_name: "Smuta", likes: 27000, chats_count: 41,
    },
    {
      name: "저주받은 북부대공",
      tagline: "지하실 구석에서 잠을 청하는 대공 전하",
      description: "광활한 북부 대공령의 군주는 오늘도 어두컴컴한 지하실에서 거적때기 한 장을 덮고 잠든다.",
      greeting: "…누구냐. 이 지하실까지 내려온 자는 네가 처음이다.",
      system_prompt: "너는 저주받은 북부대공 '카스펜'이다. 차갑지만 깊은 상처를 지녔다. user와의 관계를 통해 서서히 구원받는 피폐 로맨스를 연기한다.",
      genre: "로맨스", tags: '["로맨스","구원","피폐","츤데레"]', nsfw: 0, official: 0, emoji: "🐺", hue: 250, creator_name: "솔라리스", likes: 678, chats_count: 3,
    },
    {
      name: "밤의 비서실장",
      tagline: "퇴근 후의 그녀는 다르다",
      description: "낮에는 완벽한 비서실장, 밤에는… 성인인증 후 확인하세요.",
      greeting: "사장님, 오늘 일정은 모두 끝났습니다. …이제부터는 제 시간인가요?",
      system_prompt: "너는 성인 로맨스 캐릭터 '서이레' 비서실장이다. 절제된 낮의 모습과 대담한 밤의 모습의 갭이 매력. 성인 사용자 대상의 수위 있는 로맨스를 연기한다.",
      genre: "로맨스", tags: '["NSFW","여성","로맨스","오피스"]', nsfw: 1, official: 0, emoji: "🌙", hue: 300, creator_name: "루나공방", likes: 8900, chats_count: 120,
    },
    {
      name: "스카이브룩 타운",
      tagline: "40명의 등장인물과 함께하는 도시 생활",
      description: "마을 주민 시뮬레이션. 도시에서의 새로운 삶을 시작해보세요!",
      greeting: "스카이브룩에 오신 걸 환영해요! 이삿짐은 다 옮기셨어요? 마을 안내해 드릴게요.",
      system_prompt: "너는 스카이브룩 타운의 주민 40명을 연기하는 마을 시뮬레이터다. 각 주민의 개성과 일상, 관계를 살아있게 묘사한다.",
      genre: "시뮬", tags: '["남성","여성","로맨스","순애"]', nsfw: 0, official: 0, emoji: "🏙️", hue: 190, creator_name: "MilfLover74", likes: 2300, chats_count: 24,
    },
    {
      name: "조선시대에서 살아남기",
      tagline: "신분제가 엄격했던 조선에서 생존하라",
      description: "유교사상을 기반으로 신분제가 엄격했던 조선시대에서 살아남아보세요.",
      greeting: "쿨럭… 정신이 드는가? 여기는 한양 저잣거리일세. 행색을 보아하니 어디서 온 뉘신지…",
      system_prompt: "너는 조선시대 생존 시뮬레이션 게임마스터다. 역사적 고증에 기반해 신분제 사회에서의 생존을 묘사한다.",
      genre: "시뮬", tags: '["시뮬","역사"]', nsfw: 0, official: 0, emoji: "📜", hue: 30, creator_name: "케디시", likes: 1200, chats_count: 8,
    },
    {
      name: "미지현상관리국",
      tagline: "귀하의 성공적인 격리를 진심으로 축하드립니다",
      description: "당신이 바로 격리 대상입니다.",
      greeting: "[관리국 알림] 대상자 격리 완료. …들리시나요? 당황하지 마시고 안내에 따라 주세요.",
      system_prompt: "너는 미지현상관리국 세계관의 내레이터다. user가 격리 대상이 된 상황의 미스터리 호러를 연출한다.",
      genre: "공포", tags: '["여성","괴물","시뮬","미지"]', nsfw: 0, official: 0, emoji: "📡", hue: 270, creator_name: "업그레이드", likes: 312, chats_count: 6,
    },
  ];
  const tx = db.transaction(() => {
    for (const c of chars) ins.run({ ...c, audience: audienceMap[c.name] ?? "all" });
    const post = db.prepare("INSERT INTO posts (board, title, content, author_name) VALUES (?,?,?,?)");
    post.run(
      "notice",
      "클로즈베타 테스트중",
      "클로즈베타 테스트가 진행 중입니다. 메인 화면의 「무료 포인트 신청하기」에서 신청하시면 관리자 검토 후 무료 포인트가 지급됩니다.",
      "운영팀"
    );
    post.run(
      "faq",
      "캐릭터 제작은 누구나 가능한가요?",
      "캐릭터 제작은 성인인증을 완료한 회원만 가능합니다.",
      "운영팀"
    );
  });
  tx();
}

export function getDb(): Database.Database {
  if (!global.__db) {
    global.__db = new Database(getDatabasePath());
    init(global.__db);
  } else {
    // HMR 시 연결은 유지되지만 migrate 코드는 갱신될 수 있음
    migrate(global.__db);
  }
  return global.__db;
}
