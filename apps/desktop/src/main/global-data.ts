import { constants } from "node:fs";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export const GLOBAL_DATA_DIRECTORY_NAME = ".opendesign";
export const WORKSPACE_DATABASE_NAME = "workspace.sqlite";

export async function prepareGlobalWorkspaceDatabase(
  homeDirectory: string,
  legacyUserDataDirectory: string,
): Promise<string> {
  const globalDirectory = join(homeDirectory, GLOBAL_DATA_DIRECTORY_NAME);
  const target = join(globalDirectory, WORKSPACE_DATABASE_NAME);
  await mkdir(globalDirectory, { recursive: true });
  if (await exists(target)) return target;

  const legacy = join(legacyUserDataDirectory, WORKSPACE_DATABASE_NAME);
  if (!(await exists(legacy))) return target;

  const temporary = join(
    globalDirectory,
    `.${WORKSPACE_DATABASE_NAME}.${process.pid}.${Date.now()}.migrating`,
  );
  try {
    await copyFile(legacy, temporary, constants.COPYFILE_EXCL);
    if (await exists(`${legacy}-wal`)) {
      await copyFile(
        `${legacy}-wal`,
        `${temporary}-wal`,
        constants.COPYFILE_EXCL,
      );
    }
    if (await exists(`${temporary}-wal`)) {
      await rename(`${temporary}-wal`, `${target}-wal`);
    }
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true });
    await rm(`${temporary}-wal`, { force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
