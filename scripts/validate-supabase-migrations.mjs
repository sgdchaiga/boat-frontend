import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "supabase", "migrations");
const files = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
const versions = new Map();
const errors = [];

for (const file of files) {
  const match = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/i.exec(file);
  if (!match) {
    errors.push(`${file}: expected <14-digit-version>_<name>.sql`);
    continue;
  }
  const version = match[1];
  const existing = versions.get(version);
  if (existing) errors.push(`${file}: migration version ${version} is already used by ${existing}`);
  else versions.set(version, file);
}

if (errors.length) {
  console.error("Supabase migration validation failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Supabase migration validation passed: ${files.length} files, ${versions.size} unique versions.`);
