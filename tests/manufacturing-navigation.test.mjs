import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  cache.set(path, module.exports);
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", code)(module, module.exports, (name) => {
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  });
  return module.exports;
}
const { buildSimpleOrgNavigation } = load("src/lib/simpleOrgNavigation.ts");
const args = { businessType: "manufacturing", dashboardPage: "manufacturing", allowPayroll: true, allowFixedAssets: true, allowWallet: false, allowCommunications: false, allowManufacturing: true, allowBudget: false };
const pages = (nav) => nav.flatMap((item) => "page" in item ? [item.page] : item.children.flatMap((child) => "page" in child ? [child.page] : child.items.map((leaf) => leaf.page)));

test("enabled manufacturing payroll and fixed assets have visible main menu entries", () => {
  const nav = buildSimpleOrgNavigation(args);
  const payroll = nav.find((item) => item.name === "Payroll");
  assert.ok(payroll && "children" in payroll);
  assert.ok(pages([payroll]).includes("payroll_hub"));
  assert.ok(pages([payroll]).includes("payroll_run"));
  assert.ok(pages([payroll]).includes("payroll_reports"));
  assert.equal(nav.find((item) => item.name === "Fixed assets")?.page, "fixed_assets");
  assert.equal(pages(nav).filter((page) => page === "payroll_hub").length, 1);
});
test("disabled modules stay out of manufacturing navigation", () => {
  const routes = pages(buildSimpleOrgNavigation({ ...args, allowPayroll: false, allowFixedAssets: false }));
  assert.ok(!routes.some((page) => page.startsWith("payroll_")));
  assert.ok(!routes.includes("fixed_assets"));
});
test("general business retains one fixed-assets and payroll link", () => {
  const routes = pages(buildSimpleOrgNavigation({ ...args, businessType: "general_business" }));
  assert.equal(routes.filter((page) => page === "fixed_assets").length, 1);
  assert.equal(routes.filter((page) => page === "payroll_hub").length, 1);
});
