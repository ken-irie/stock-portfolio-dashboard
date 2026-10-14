// 公開用のファイルだけを dist/ にコピーする。
// プロジェクト直下には保有明細のCSVや接続情報があるため、フォルダごと公開しない。
import { rmSync, mkdirSync, copyFileSync } from "node:fs";

const FILES = {
  "portfolio_app.html": "index.html",
  "style.css": "style.css",
  "sectors.js": "sectors.js",
  "assets.js": "assets.js",
  "supabase.js": "supabase.js",
  "app.js": "app.js",
  "worker/login.html": "login.html",
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const [from, to] of Object.entries(FILES)) copyFileSync(from, "dist/" + to);
console.log("dist/ に " + Object.keys(FILES).length + " ファイルをコピーしました");
