/** Shared test fixtures: throwaway project directories + in-memory database. */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type Database } from '../src/storage/db.js';

export interface TempProject {
  dir: string;
  db: Database;
  projectId: string;
  cleanup(): void;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

export async function makeProject(files: Record<string, string> = {}): Promise<TempProject> {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-test-'));
  writeFiles(dir, { 'package.json': JSON.stringify({ name: 'fixture', scripts: { build: 'tsc' } }), ...files });
  const db = await createTestDatabase();
  const project = await db.projects.create({ name: 'fixture', rootPath: dir });
  return {
    dir,
    db,
    projectId: project.id,
    cleanup() {
      void db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function makeEmptyDb(): Promise<Database> {
  return createTestDatabase();
}

export const FIXTURE_APP = `import express from 'express';
import { db } from './db';

const app = express();

app.get('/api/users', async (req, res) => {
  const users = await db.user.findMany();
  res.json(users);
});

export function createServer() {
  return app.listen(3000);
}

export class UserService {
  async listUsers() {
    return db.user.findMany();
  }
}
`;
