#!/usr/bin/env node
/* 测试入口：node tests/run.mjs [只跑匹配的文件名片段]
   零依赖，直接驱动无头 Chrome，不需要装任何 npm 包。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";

const files = fs.readdirSync(HERE)
  .filter(f => f.endsWith(".test.mjs") && f.includes(filter))
  .sort();

if (!files.length) { console.error("没有匹配的测试文件"); process.exit(1); }

console.log(`\n壹页 · 测试套件  （${files.length} 个文件${filter ? `，筛选：${filter}` : ""}）`);
console.log("═".repeat(64));

let totalPass = 0, totalFail = 0; const failedFiles = [];

for (const f of files) {
  console.log(`\n▌ ${f}`);
  try {
    const mod = await import(path.join(HERE, f));
    const suite = await mod.default();
    totalPass += suite.pass; totalFail += suite.fail;
    if (suite.fail) failedFiles.push(f);
  } catch (e) {
    console.log(`  ✗ 测试文件执行失败：${e.message}`);
    totalFail++; failedFiles.push(f);
  }
}

console.log("\n" + "═".repeat(64));
console.log(`总计：${totalPass} 通过 / ${totalFail} 失败`);
if (failedFiles.length) console.log("失败文件：" + failedFiles.join(", "));
process.exit(totalFail ? 1 : 0);
