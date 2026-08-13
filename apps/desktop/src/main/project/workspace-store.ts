import type {
  ConversationDescriptor,
  GlobalTaskProjection,
  RootGrant,
} from "@opendesign/workspace-contracts";
import {
  isConversationDescriptor,
  isGlobalTaskProjection,
  isRootGrant,
  normalizeGlobalTaskProjection,
} from "@opendesign/workspace-contracts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface RecentProject {
  projectId: string;
  name: string;
  lastOpenedAt: string;
}

interface ProjectRegistration extends RecentProject {
  rootPath: string;
  reveal?: boolean;
}

export interface ProjectRegistrationResult {
  displacedProjectId: string | null;
}

export class WorkspaceStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT UNIQUE,
        last_opened_at TEXT NOT NULL,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        home_project_id TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_home_project
        ON conversations(home_project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS root_grants (
        root_grant_id TEXT PRIMARY KEY,
        descriptor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS global_tasks (
        task_id TEXT PRIMARY KEY,
        home_project_id TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS global_tasks_updated
        ON global_tasks(updated_at DESC);

      CREATE TABLE IF NOT EXISTS app_preferences (
        preference_key TEXT PRIMARY KEY,
        preference_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    let projectColumns = this.#database
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{ name: string; notnull: number }>;
    if (!projectColumns.some(({ name }) => name === "is_visible")) {
      this.#database.exec(
        "ALTER TABLE projects ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0, 1))",
      );
      projectColumns = this.#database
        .prepare("PRAGMA table_info(projects)")
        .all() as Array<{ name: string; notnull: number }>;
    }
    if (
      projectColumns.find(({ name }) => name === "root_path")?.notnull === 1
    ) {
      migrateProjectsRootPathToNullable(this.#database);
    }
  }

  getPreference(key: string): string | null {
    assertPreferenceKey(key);
    const row = this.#database
      .prepare(
        "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
      )
      .get(key) as { preference_value: string } | undefined;
    return row?.preference_value ?? null;
  }

  setPreference(key: string, value: string): void {
    assertPreferenceKey(key);
    if (value.length > 262_144) {
      throw new RangeError("Preference value exceeds the 256 KB limit");
    }
    this.#database
      .prepare(
        `
          INSERT INTO app_preferences(
            preference_key,
            preference_value,
            updated_at
          ) VALUES (?, ?, ?)
          ON CONFLICT(preference_key) DO UPDATE SET
            preference_value = excluded.preference_value,
            updated_at = excluded.updated_at
        `,
      )
      .run(key, value, new Date().toISOString());
  }

  deletePreference(key: string): void {
    assertPreferenceKey(key);
    this.#database
      .prepare("DELETE FROM app_preferences WHERE preference_key = ?")
      .run(key);
  }

  upsertProject(project: ProjectRegistration): ProjectRegistrationResult {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const displaced = this.#database
        .prepare(
          `
            SELECT project_id
            FROM projects
            WHERE root_path = ? AND project_id <> ?
          `,
        )
        .get(project.rootPath, project.projectId) as
        { project_id: string } | undefined;

      if (displaced) {
        this.#database
          .prepare(
            `
              UPDATE projects
              SET root_path = NULL, is_visible = 0
              WHERE project_id = ?
            `,
          )
          .run(displaced.project_id);
      }

      this.#database
        .prepare(
          `
            INSERT INTO projects(
              project_id,
              name,
              root_path,
              last_opened_at,
              is_visible
            )
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(project_id) DO UPDATE SET
              name = excluded.name,
              root_path = excluded.root_path,
              last_opened_at = excluded.last_opened_at,
              is_visible = CASE
                WHEN ? = 1 THEN 1
                ELSE projects.is_visible
              END
          `,
        )
        .run(
          project.projectId,
          project.name,
          project.rootPath,
          project.lastOpenedAt,
          project.reveal ? 1 : 0,
        );
      this.#database.exec("COMMIT");
      return { displacedProjectId: displaced?.project_id ?? null };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  hideProject(projectId: string): void {
    this.#database
      .prepare("UPDATE projects SET is_visible = 0 WHERE project_id = ?")
      .run(projectId);
  }

  getProjectRoot(projectId: string): string | null {
    const row = this.#database
      .prepare("SELECT root_path FROM projects WHERE project_id = ?")
      .get(projectId) as { root_path: string } | undefined;
    return row?.root_path ?? null;
  }

  listRecentProjects(limit = 20): RecentProject[] {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = this.#database
      .prepare(
        `
          SELECT project_id, name, last_opened_at
          FROM projects
          WHERE is_visible = 1 AND root_path IS NOT NULL
          ORDER BY last_opened_at DESC, project_id ASC
          LIMIT ?
        `,
      )
      .all(boundedLimit) as Array<{
      project_id: string;
      name: string;
      last_opened_at: string;
    }>;
    return rows.map((row) => ({
      projectId: row.project_id,
      name: row.name,
      lastOpenedAt: row.last_opened_at,
    }));
  }

  createConversation(conversation: ConversationDescriptor): void {
    if (!isConversationDescriptor(conversation)) {
      throw new TypeError("Invalid conversation descriptor");
    }
    this.#database
      .prepare(
        `
          INSERT INTO conversations(
            conversation_id,
            home_project_id,
            descriptor_json,
            updated_at
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        conversation.conversationId,
        conversation.homeProjectId,
        JSON.stringify(conversation),
        conversation.updatedAt,
      );
  }

  saveConversation(conversation: ConversationDescriptor): void {
    if (!isConversationDescriptor(conversation)) {
      throw new TypeError("Invalid conversation descriptor");
    }
    const existing = this.#database
      .prepare(
        "SELECT home_project_id FROM conversations WHERE conversation_id = ?",
      )
      .get(conversation.conversationId) as
      { home_project_id: string } | undefined;
    if (existing && existing.home_project_id !== conversation.homeProjectId) {
      throw new Error("Conversation Home Project cannot be changed by save");
    }
    this.#database
      .prepare(
        `
          INSERT INTO conversations(
            conversation_id,
            home_project_id,
            descriptor_json,
            updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(conversation_id) DO UPDATE SET
            descriptor_json = excluded.descriptor_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        conversation.conversationId,
        conversation.homeProjectId,
        JSON.stringify(conversation),
        conversation.updatedAt,
      );
  }

  getConversation(conversationId: string): ConversationDescriptor | null {
    const row = this.#database
      .prepare(
        "SELECT descriptor_json FROM conversations WHERE conversation_id = ?",
      )
      .get(conversationId) as { descriptor_json: string } | undefined;
    if (!row) return null;
    return parseRows([row], isConversationDescriptor)[0] ?? null;
  }

  listConversations(homeProjectId: string): ConversationDescriptor[] {
    const rows = this.#database
      .prepare(
        `
          SELECT descriptor_json
          FROM conversations
          WHERE home_project_id = ?
          ORDER BY updated_at DESC, conversation_id ASC
        `,
      )
      .all(homeProjectId) as Array<{ descriptor_json: string }>;
    return parseRows(rows, isConversationDescriptor);
  }

  saveRootGrant(grant: RootGrant): void {
    if (!isRootGrant(grant)) throw new TypeError("Invalid root grant");
    const updatedAt = grant.revokedAt ?? grant.expiresAt ?? grant.createdAt;
    this.#database
      .prepare(
        `
          INSERT INTO root_grants(root_grant_id, descriptor_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(root_grant_id) DO UPDATE SET
            descriptor_json = excluded.descriptor_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(grant.rootGrantId, JSON.stringify(grant), updatedAt);
  }

  listRootGrants(): RootGrant[] {
    const rows = this.#database
      .prepare(
        `
          SELECT descriptor_json
          FROM root_grants
          ORDER BY updated_at DESC, root_grant_id ASC
        `,
      )
      .all() as Array<{ descriptor_json: string }>;
    return parseRows(rows, isRootGrant);
  }

  saveGlobalTask(task: GlobalTaskProjection): void {
    if (!isGlobalTaskProjection(task)) {
      throw new TypeError("Invalid global task projection");
    }
    this.#database
      .prepare(
        `
          INSERT INTO global_tasks(
            task_id,
            home_project_id,
            projection_json,
            updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(task_id) DO UPDATE SET
            home_project_id = excluded.home_project_id,
            projection_json = excluded.projection_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        task.taskId,
        task.homeProjectId,
        JSON.stringify(task),
        task.updatedAt,
      );
  }

  listGlobalTasks(): GlobalTaskProjection[] {
    const rows = this.#database
      .prepare(
        `
          SELECT projection_json AS descriptor_json
          FROM global_tasks
          ORDER BY updated_at DESC, task_id ASC
        `,
      )
      .all() as Array<{ descriptor_json: string }>;
    return parseMappedRows(rows, normalizeGlobalTaskProjection);
  }

  close(): void {
    this.#database.close();
  }
}

function migrateProjectsRootPathToNullable(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE projects_with_detachable_root (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT UNIQUE,
        last_opened_at TEXT NOT NULL,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0, 1))
      );
      INSERT INTO projects_with_detachable_root(
        project_id,
        name,
        root_path,
        last_opened_at,
        is_visible
      )
      SELECT project_id, name, root_path, last_opened_at, is_visible
      FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_with_detachable_root RENAME TO projects;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function assertPreferenceKey(key: string): void {
  if (!/^[a-z][a-z0-9.-]{0,127}$/.test(key)) {
    throw new TypeError("Invalid preference key");
  }
}

function parseRows<T>(
  rows: Array<{ descriptor_json: string }>,
  guard: (value: unknown) => value is T,
): T[] {
  return rows.flatMap((row) => {
    try {
      const value: unknown = JSON.parse(row.descriptor_json);
      return guard(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

function parseMappedRows<T>(
  rows: Array<{ descriptor_json: string }>,
  parse: (value: unknown) => T | null,
): T[] {
  return rows.flatMap((row) => {
    try {
      const parsed = parse(JSON.parse(row.descriptor_json));
      return parsed === null ? [] : [parsed];
    } catch {
      return [];
    }
  });
}
