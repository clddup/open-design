import type {
  ConversationDescriptor,
  GlobalTaskProjection,
  RootGrant,
} from "@opendesign/workspace-contracts";
import {
  ConversationDescriptorContract,
  ConversationDescriptorListContract,
  DESIGN_DELIVERY_LEDGER_VERSION,
  GlobalTaskProjectionContract,
  isRootGrant,
} from "@opendesign/workspace-contracts";
import { formatContractFailure } from "@opendesign/contract-runtime";
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
        origin_project_id TEXT,
        filed_project_id TEXT,
        descriptor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS root_grants (
        root_grant_id TEXT PRIMARY KEY,
        descriptor_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS global_tasks (
        task_id TEXT PRIMARY KEY,
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
    const conversationColumns = this.#database
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    const globalTaskColumns = this.#database
      .prepare("PRAGMA table_info(global_tasks)")
      .all() as Array<{ name: string }>;
    if (
      !conversationColumns.some(({ name }) => name === "filed_project_id") ||
      globalTaskColumns.some(({ name }) => name === "home_project_id")
    ) {
      resetConversationAndTaskSchema(this.#database);
    }
    discardObsoleteGlobalTaskRows(this.#database);
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS conversations_filed_project
        ON conversations(filed_project_id, updated_at DESC);
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
    const canonical = requireConversationDescriptor(conversation);
    this.#database
      .prepare(
        `
          INSERT INTO conversations(
            conversation_id,
            origin_project_id,
            filed_project_id,
            descriptor_json,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        canonical.conversationId,
        canonical.originProjectId,
        canonical.filedProjectId,
        JSON.stringify(canonical),
        canonical.updatedAt,
      );
  }

  saveConversation(conversation: ConversationDescriptor): void {
    const canonical = requireConversationDescriptor(conversation);
    const existing = this.#database
      .prepare(
        "SELECT origin_project_id FROM conversations WHERE conversation_id = ?",
      )
      .get(canonical.conversationId) as
      { origin_project_id: string | null } | undefined;
    if (!existing) {
      throw new Error("Conversation does not exist");
    }
    if (existing.origin_project_id !== canonical.originProjectId) {
      throw new Error("Conversation origin Project cannot be changed by save");
    }
    this.#database
      .prepare(
        `
          UPDATE conversations
          SET filed_project_id = ?, descriptor_json = ?, updated_at = ?
          WHERE conversation_id = ?
        `,
      )
      .run(
        canonical.filedProjectId,
        JSON.stringify(canonical),
        canonical.updatedAt,
        canonical.conversationId,
      );
  }

  getConversation(conversationId: string): ConversationDescriptor | null {
    const row = this.#database
      .prepare(
        `
          SELECT conversation_id, origin_project_id, filed_project_id,
                 descriptor_json, updated_at
          FROM conversations
          WHERE conversation_id = ?
        `,
      )
      .get(conversationId) as ConversationRow | undefined;
    if (!row) return null;
    return parseConversationRow(row);
  }

  listConversations(): ConversationDescriptor[] {
    const rows = this.#database
      .prepare(
        `
          SELECT conversation_id, origin_project_id, filed_project_id,
                 descriptor_json, updated_at
          FROM conversations
          ORDER BY updated_at DESC, conversation_id ASC
        `,
      )
      .all() as ConversationRow[];
    const conversations = rows.map(parseConversationRow);
    const result = ConversationDescriptorListContract.parse(conversations);
    if (!result.ok) {
      throw new TypeError(
        formatContractFailure("Conversation descriptor list", result.issues),
      );
    }
    return result.value;
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
    const canonical = requireGlobalTaskProjection(task);
    this.#database
      .prepare(
        `
          INSERT INTO global_tasks(
            task_id,
            projection_json,
            updated_at
          ) VALUES (?, ?, ?)
          ON CONFLICT(task_id) DO UPDATE SET
            projection_json = excluded.projection_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(canonical.taskId, JSON.stringify(canonical), canonical.updatedAt);
  }

  listGlobalTasks(): GlobalTaskProjection[] {
    const rows = this.#database
      .prepare(
        `
          SELECT task_id, projection_json, updated_at
          FROM global_tasks
          ORDER BY updated_at DESC, task_id ASC
        `,
      )
      .all() as GlobalTaskRow[];
    return rows.map(parseGlobalTaskRow);
  }

  close(): void {
    this.#database.close();
  }
}

function resetConversationAndTaskSchema(database: DatabaseSync): void {
  database.exec(`
    DROP TABLE IF EXISTS global_tasks;
    DROP TABLE IF EXISTS conversations;

    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY,
      origin_project_id TEXT,
      filed_project_id TEXT,
      descriptor_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX conversations_filed_project
      ON conversations(filed_project_id, updated_at DESC);

    CREATE TABLE global_tasks (
      task_id TEXT PRIMARY KEY,
      projection_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX global_tasks_updated
      ON global_tasks(updated_at DESC);
  `);
}

function discardObsoleteGlobalTaskRows(database: DatabaseSync): void {
  const rows = database
    .prepare("SELECT task_id, projection_json FROM global_tasks")
    .all() as Array<{ task_id: string; projection_json: string }>;
  const remove = database.prepare("DELETE FROM global_tasks WHERE task_id = ?");
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.projection_json);
    } catch {
      continue;
    }
    if (!isRecord(value) || !isRecord(value.delivery)) continue;
    const deliveryVersion = value.delivery.version;
    if (
      typeof deliveryVersion !== "number" ||
      !Number.isInteger(deliveryVersion) ||
      deliveryVersion >= DESIGN_DELIVERY_LEDGER_VERSION
    ) {
      continue;
    }
    remove.run(row.task_id);
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

type ConversationRow = {
  conversation_id: string;
  origin_project_id: string | null;
  filed_project_id: string | null;
  descriptor_json: string;
  updated_at: string;
};

type GlobalTaskRow = {
  task_id: string;
  projection_json: string;
  updated_at: string;
};

function requireConversationDescriptor(value: unknown): ConversationDescriptor {
  const result = ConversationDescriptorContract.parse(value);
  if (!result.ok) {
    throw new TypeError(
      formatContractFailure("Conversation descriptor", result.issues),
    );
  }
  return result.value;
}

function parseConversationRow(row: ConversationRow): ConversationDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(row.descriptor_json);
  } catch {
    throw new TypeError("Invalid persisted Conversation JSON");
  }
  const descriptor = requireConversationDescriptor(value);
  const mismatches = [
    descriptor.conversationId === row.conversation_id
      ? null
      : "/conversationId",
    descriptor.originProjectId === row.origin_project_id
      ? null
      : "/originProjectId",
    descriptor.filedProjectId === row.filed_project_id
      ? null
      : "/filedProjectId",
    descriptor.updatedAt === row.updated_at ? null : "/updatedAt",
  ].filter((path): path is string => path !== null);
  if (mismatches.length > 0) {
    throw new TypeError(
      `Persisted Conversation columns disagree with descriptor JSON at ${mismatches.join(
        ", ",
      )}`,
    );
  }
  return descriptor;
}

function requireGlobalTaskProjection(value: unknown): GlobalTaskProjection {
  const result = GlobalTaskProjectionContract.parse(value);
  if (!result.ok) {
    throw new TypeError(
      formatContractFailure("Global Task projection", result.issues),
    );
  }
  return result.value;
}

function parseGlobalTaskRow(row: GlobalTaskRow): GlobalTaskProjection {
  let value: unknown;
  try {
    value = JSON.parse(row.projection_json);
  } catch {
    throw new TypeError("Invalid persisted Global Task JSON");
  }
  const task = requireGlobalTaskProjection(value);
  const mismatches = [
    task.taskId === row.task_id ? null : "/taskId",
    task.updatedAt === row.updated_at ? null : "/updatedAt",
  ].filter((path): path is string => path !== null);
  if (mismatches.length > 0) {
    throw new TypeError(
      `Persisted Global Task columns disagree with projection JSON at ${mismatches.join(
        ", ",
      )}`,
    );
  }
  return task;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
