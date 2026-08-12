# Supabase連携 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 資産推移（日付・資産残高・元本）と保有明細をSupabaseに保存し、起動時に資産推移をDBから読み戻す。

**Architecture:** 外部ライブラリを使わず、素の `fetch` で Supabase の PostgREST REST API を直接叩く。DBアクセスは `supabase.js` の5関数に閉じ込め、`app.js` からは4か所のフックで呼ぶだけにする。`loadHist()` が同期関数のままでよいよう、localStorage を同期キャッシュとして残し、起動時にDBの内容で上書きする。

**Tech Stack:** バニラJS（ビルドなし・依存なし）、Supabase（PostgREST REST API）、ブラウザで開くだけの自作テストページ

**Spec:** `docs/superpowers/specs/2026-08-13-supabase-portfolio-sync-design.md`

**Branch:** `supabase-sync`（作成済み。設計書と `.gitignore` の変更はコミット済み）

---

## テストの実行方法

`test/supabase.test.html` は相対パスで `../supabase.js` を読むため、**`file://` で直接開いても動かない環境がある**（エージェントのプレビューは `file://` を data: URL のスナップショットとして描画するので、相対スクリプトが解決されない）。ローカルHTTPサーバー経由で開くこと。

`.claude/launch.json` に設定済みの `portfolio-local`（ポート8734、ルートは `C:\work\02_programs\12_kabu`）を使う。

```
preview_start { name: "portfolio-local" }
navigate      { url: "http://localhost:8734/test/supabase.test.html" }
get_page_text
```

再実行は同じURLへ `navigate` し直す。結果は1行目に `ALL PASS (N)` または `N FAILED / M passed` と出る。

**キャッシュに注意。** `supabase.js` を編集した直後は、サーバーが古い内容を返して結果が変わらないことがある。クエリ文字列を毎回変えて開くこと（例: `?v=t3`）。結果が変わらないときは、まず配信されている中身が編集後のものか疑う。

人間が確認する場合は、ブラウザで `http://localhost:8734/test/supabase.test.html` を開く。

## 前提

- 作業ブランチ `supabase-sync` に既にいること。`git branch --show-current` で確認する
- `.gitignore` には `supabase-config.js` が既に追加済み（前コミット `b32cb68`）
- Supabaseプロジェクトはまだ存在しない。Task 8までは実DBなしで進められる

## ファイル構成

| ファイル | 扱い | 責務 |
|---|---|---|
| `supabase.js` | 新規 | DBアクセス層。`sbEnabled` / `sbSaveSnapshot` / `sbLoadHistory` / `sbDeleteDay` / `sbDeleteAll` の5関数だけを `window` に公開する。HTTPの入口は内部の `sbFetch` 1か所に集約 |
| `test/supabase.test.html` | 新規 | `supabase.js` の単体テスト。`window.fetch` をモックに差し替えて検証。ブラウザで開くと結果が出る |
| `supabase-config.example.js` | 新規 | 接続情報の雛形 |
| `supabase-config.js` | 新規・gitignore | 実際の接続情報。Task 8で作る |
| `portfolio_app.html` | 変更 | `<script>` 2本と `<small id="dbStat">` を追加 |
| `style.css` | 変更 | `#dbStat` のスタイル追加 |
| `app.js` | 変更 | 4か所にフックを差す（保存・起動時読み戻し・全削除・単日削除） |
| `README.md` | 変更 | セットアップ手順を追記 |

`supabase.js` は接続情報を**呼び出しのたびに** `window.SUPABASE_CONFIG` から読む。読み込み順に左右されず、テストから差し替えられるようにするため。

---

### Task 1: テストページと supabase.js の土台

**Files:**
- Create: `test/supabase.test.html`
- Create: `supabase.js`

- [ ] **Step 1: テストページを作る（この時点では失敗する）**

`test/supabase.test.html` を新規作成する。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>supabase.js テスト</title>
<style>
  body{background:#12151c;color:#e8ebf2;font-family:monospace;padding:24px;line-height:1.7;}
  .ok{color:#6fcf97;} .ng{color:#ff8a8a;}
  h1{font-size:16px;} #sum{font-size:15px;font-weight:700;margin-bottom:12px;}
</style>
</head>
<body>
<h1>supabase.js テスト</h1>
<div id="sum">実行中…</div>
<pre id="out"></pre>
<!-- sbStatus() の書き込み先。本番のカードヘッダと同じid -->
<span id="dbStat" hidden></span>

<script src="../supabase.js"></script>
<script>
// ---- 最小のテストハーネス ----
const TESTS=[];
function test(name, fn){ TESTS.push({name, fn}); }
function assert(cond, msg){ if(!cond) throw new Error(msg||"assertion failed"); }
function eq(actual, expected, msg){
  const a=JSON.stringify(actual), b=JSON.stringify(expected);
  if(a!==b) throw new Error((msg?msg+": ":"")+"expected "+b+" but got "+a);
}
// fetchのモック。responses[i] が i回目の応答になる
function mockFetch(responses){
  const calls=[];
  const fn=async (url, opts)=>{
    const r=responses[calls.length] || {};
    calls.push({url:String(url), method:(opts&&opts.method)||"GET",
                headers:(opts&&opts.headers)||{}, body:(opts&&opts.body)||null,
                signal:(opts&&opts.signal)||null});
    if(r.throw) throw new Error(r.throw);
    return {
      ok: r.ok!==false,
      status: r.status||200,
      json: async()=> r.body!==undefined ? r.body : [],
      text: async()=> JSON.stringify(r.body!==undefined ? r.body : [])
    };
  };
  fn.calls=calls;
  return fn;
}
// テストごとに設定とfetchを入れ替え、終わったら必ず戻す
async function withEnv(config, responses, fn){
  const oldCfg=window.SUPABASE_CONFIG, oldFetch=window.fetch;
  window.SUPABASE_CONFIG=config;
  const mf=mockFetch(responses||[]);
  window.fetch=mf;
  try{ return await fn(mf); }
  finally{ window.SUPABASE_CONFIG=oldCfg; window.fetch=oldFetch; }
}
const CFG={url:"https://demo.supabase.co", key:"testkey"};
const statText=()=>document.getElementById("dbStat").textContent;

// === tests ===

test("sbEnabled: 設定が無ければfalse", async()=>{
  await withEnv(undefined, [], async()=>{ eq(sbEnabled(), false); });
});

test("sbEnabled: urlが空ならfalse", async()=>{
  await withEnv({url:"", key:"k"}, [], async()=>{ eq(sbEnabled(), false); });
});

test("sbEnabled: keyが空ならfalse", async()=>{
  await withEnv({url:"https://demo.supabase.co", key:""}, [], async()=>{ eq(sbEnabled(), false); });
});

test("sbEnabled: url/keyが揃っていればtrue", async()=>{
  await withEnv(CFG, [], async()=>{ eq(sbEnabled(), true); });
});

test("sbStatus: 3状態で文言とclassが変わる", async()=>{
  const el=document.getElementById("dbStat");
  sbStatus("unset"); eq(el.textContent, "DB未設定"); eq(el.className, "dbstat unset");
  sbStatus("ok");    eq(el.textContent, "DB同期済"); eq(el.className, "dbstat ok");
  sbStatus("error"); eq(el.textContent, "DB同期失敗"); eq(el.className, "dbstat error");
});

// === /tests ===

(async function run(){
  const out=document.getElementById("out");
  let pass=0, fail=0; const lines=[];
  for(const t of TESTS){
    try{ await t.fn(); pass++; lines.push('<span class="ok">PASS</span> '+t.name); }
    catch(e){ fail++; lines.push('<span class="ng">FAIL</span> '+t.name+'\n       '+e.message); }
  }
  out.innerHTML=lines.join("\n");
  document.getElementById("sum").innerHTML =
    fail===0 ? '<span class="ok">ALL PASS ('+pass+')</span>'
             : '<span class="ng">'+fail+' FAILED</span> / '+pass+' passed';
  document.title = (fail===0?"ALL PASS":"FAILED")+" - supabase.js テスト";
})();
</script>
</body>
</html>
```

`sbStatus` はテストから呼ぶため `window` に公開する。設計書では「内部」扱いだが、テスト可能性を優先して公開関数に含める（`app.js` からは呼ばない）。

- [ ] **Step 2: テストを実行して失敗を確認する**

冒頭「テストの実行方法」の手順で `http://localhost:8734/test/supabase.test.html` を開く。

期待: `5 FAILED / 0 passed`。すべて `sbEnabled is not defined` / `sbStatus is not defined` で落ちる（`supabase.js` がまだ無いため）。

- [ ] **Step 3: supabase.js を作る（最小実装）**

`supabase.js` を新規作成する。

```js
// Supabase(PostgREST)への保存・読み込み。外部ライブラリは使わない。
// app.jsから使う入口は sbEnabled / sbSaveSnapshot / sbLoadHistory / sbDeleteDay / sbDeleteAll の5つ。
(function(){

  // 接続情報は呼び出しのたびに読む（スクリプトの読み込み順やテストでの差し替えに影響されないため）
  function cfg(){
    const c=window.SUPABASE_CONFIG;
    if(!c) return null;
    const url=(c.url||"").replace(/\/+$/,"");   // 末尾スラッシュを落として結合を安定させる
    const key=c.key||"";
    return (url&&key) ? {url,key} : null;
  }

  function sbEnabled(){ return !!cfg(); }

  // 同期ステータス表示（unset / ok / error）
  function sbStatus(state){
    const el=document.getElementById("dbStat");
    if(!el) return;
    el.textContent = state==="ok" ? "DB同期済"
                   : state==="error" ? "DB同期失敗"
                   : "DB未設定";
    el.className = "dbstat "+state;
  }

  window.sbEnabled=sbEnabled;
  window.sbStatus=sbStatus;

  // 設定が無いことは起動時点で分かるので、その場で表示しておく
  if(!sbEnabled()) sbStatus("unset");

})();
```

- [ ] **Step 4: テストを実行して通ることを確認する**

`test/supabase.test.html` をブラウザで再読込する。

期待: `ALL PASS (5)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "supabase.js の土台とテストページを追加"
```

---

### Task 2: sbLoadHistory と共通HTTP入口 sbFetch

**Files:**
- Modify: `supabase.js`
- Modify: `test/supabase.test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test/supabase.test.html` の `// === /tests ===` の**直前**に、以下を追加する。

```js
test("sbLoadHistory: 取得結果を{date,total,cost}の配列に変換する", async()=>{
  const body=[{snapshot_date:"2026-08-01", total_value:"1000", total_cost:"800"},
              {snapshot_date:"2026-08-02", total_value:"1100", total_cost:"800"}];
  await withEnv(CFG, [{body}], async()=>{
    const r=await sbLoadHistory();
    eq(r, [{date:"2026-08-01", total:1000, cost:800},
           {date:"2026-08-02", total:1100, cost:800}]);
    eq(statText(), "DB同期済");
  });
});

test("sbLoadHistory: URLに日付昇順のクエリが付く", async()=>{
  await withEnv(CFG, [{body:[]}], async(mf)=>{
    await sbLoadHistory();
    eq(mf.calls.length, 1);
    eq(mf.calls[0].url,
       "https://demo.supabase.co/rest/v1/snapshots?select=snapshot_date,total_value,total_cost&order=snapshot_date.asc");
    eq(mf.calls[0].method, "GET");
  });
});

test("sbLoadHistory: 認証ヘッダとタイムアウトが付く", async()=>{
  await withEnv(CFG, [{body:[]}], async(mf)=>{
    await sbLoadHistory();
    const h=mf.calls[0].headers;
    eq(h["apikey"], "testkey");
    eq(h["Authorization"], "Bearer testkey");
    eq(h["Content-Type"], "application/json");
    assert(mf.calls[0].signal, "AbortSignalが渡されていない");
  });
});

test("sbLoadHistory: 末尾スラッシュ付きのurlでも正しく結合する", async()=>{
  await withEnv({url:"https://demo.supabase.co/", key:"testkey"}, [{body:[]}], async(mf)=>{
    await sbLoadHistory();
    assert(mf.calls[0].url.startsWith("https://demo.supabase.co/rest/v1/snapshots?"),
           "URLが二重スラッシュになっている: "+mf.calls[0].url);
  });
});

test("sbLoadHistory: 4xxならnullを返しステータスが失敗になる", async()=>{
  await withEnv(CFG, [{ok:false, status:401, body:{message:"unauthorized"}}], async()=>{
    eq(await sbLoadHistory(), null);
    eq(statText(), "DB同期失敗");
  });
});

test("sbLoadHistory: fetchが失敗しても例外を投げずnullを返す", async()=>{
  await withEnv(CFG, [{throw:"network down"}], async()=>{
    eq(await sbLoadHistory(), null);
  });
});

test("sbLoadHistory: 設定が無ければfetchを呼ばずnullを返す", async()=>{
  await withEnv(undefined, [], async(mf)=>{
    eq(await sbLoadHistory(), null);
    eq(mf.calls.length, 0);
  });
});

test("sbLoadHistory: 空配列とnullを区別できる", async()=>{
  await withEnv(CFG, [{body:[]}], async()=>{
    eq(await sbLoadHistory(), []);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

ブラウザで再読込する。

期待: `8 FAILED / 5 passed`。すべて `sbLoadHistory is not defined`。

- [ ] **Step 3: sbFetch と sbLoadHistory を実装する**

`supabase.js` の `window.sbEnabled=sbEnabled;` の**直前**に、以下を挿入する。

```js
  const TIMEOUT=10000;   // file://から外部通信がブロックされている環境で固まらないよう打ち切る

  // HTTPの入口はここ1か所だけ。成功ならResponse、失敗ならnullを返す（例外は投げない）
  async function sbFetch(path, options){
    const c=cfg();
    if(!c) return null;
    const opt=options||{};
    const headers=Object.assign({
      "apikey":c.key,
      "Authorization":"Bearer "+c.key,
      "Content-Type":"application/json"
    }, opt.headers||{});
    try{
      const res=await window.fetch(c.url+"/rest/v1/"+path, {
        method:opt.method||"GET",
        headers,
        body:opt.body!==undefined ? JSON.stringify(opt.body) : undefined,
        signal:AbortSignal.timeout(TIMEOUT)
      });
      if(!res.ok){
        let detail=""; try{ detail=await res.text(); }catch{}
        console.warn("[supabase] "+res.status+" "+path, detail);
        return null;
      }
      return res;
    }catch(e){
      console.warn("[supabase] request failed: "+path, e);
      return null;
    }
  }

  // 資産推移を取得する。失敗はnull、DBが空なら空配列（app.js側で区別する）
  async function sbLoadHistory(){
    if(!sbEnabled()) return null;   // 未設定時は「DB未設定」表示のままにする
    const res=await sbFetch("snapshots?select=snapshot_date,total_value,total_cost&order=snapshot_date.asc");
    if(!res){ sbStatus("error"); return null; }
    try{
      const rows=await res.json();
      if(!Array.isArray(rows)){ sbStatus("error"); return null; }
      sbStatus("ok");
      return rows.map(r=>({
        date:r.snapshot_date,
        total:Number(r.total_value),
        cost:Number(r.total_cost)
      }));
    }catch(e){
      console.warn("[supabase] failed to parse history", e);
      sbStatus("error");
      return null;
    }
  }
```

同じファイルの公開部分に1行追加する。

```js
  window.sbEnabled=sbEnabled;
  window.sbStatus=sbStatus;
  window.sbLoadHistory=sbLoadHistory;
```

- [ ] **Step 4: テストを実行して通ることを確認する**

ブラウザで再読込する。

期待: `ALL PASS (13)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbLoadHistory と共通HTTP入口 sbFetch を実装"
```

---

### Task 3: sbSaveSnapshot

**Files:**
- Modify: `supabase.js`
- Modify: `test/supabase.test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test/supabase.test.html` の `// === /tests ===` の**直前**に、以下を追加する。

```js
const SNAP={
  date:"2026-08-13", total:1500, cost:1200,
  rows:[
    {name:"トヨタ自動車", code:"7203", value:1000, cost:800, cat:"jp", acct:"特定", qty:100, broker:"SBI"},
    {name:"現金",         code:"",     value:500,  cost:400}   // broker/acct/qty が無い行
  ]
};

test("sbSaveSnapshot: upsert→明細DELETE→明細INSERT の順に3リクエスト出す", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    eq(await sbSaveSnapshot(SNAP), true);
    eq(mf.calls.length, 3);
    eq(mf.calls[0].method, "POST");
    eq(mf.calls[0].url, "https://demo.supabase.co/rest/v1/snapshots");
    eq(mf.calls[1].method, "DELETE");
    eq(mf.calls[1].url, "https://demo.supabase.co/rest/v1/holdings?snapshot_date=eq.2026-08-13");
    eq(mf.calls[2].method, "POST");
    eq(mf.calls[2].url, "https://demo.supabase.co/rest/v1/holdings");
  });
});

test("sbSaveSnapshot: upsertにmerge-duplicatesヘッダが付く", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    await sbSaveSnapshot(SNAP);
    eq(mf.calls[0].headers["Prefer"], "resolution=merge-duplicates,return=minimal");
  });
});

test("sbSaveSnapshot: upsertのbodyにupdated_atを含む", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    await sbSaveSnapshot(SNAP);
    const b=JSON.parse(mf.calls[0].body);
    eq(b.snapshot_date, "2026-08-13");
    eq(b.total_value, 1500);
    eq(b.total_cost, 1200);
    assert(/^\d{4}-\d{2}-\d{2}T/.test(b.updated_at), "updated_atがISO形式でない: "+b.updated_at);
  });
});

test("sbSaveSnapshot: RAWの行をholdingsの列に写す（欠損はnull）", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    await sbSaveSnapshot(SNAP);
    const rows=JSON.parse(mf.calls[2].body);
    eq(rows.length, 2);
    eq(rows[0], {snapshot_date:"2026-08-13", name:"トヨタ自動車", code:"7203",
                 broker:"SBI", acct:"特定", cat:"jp", qty:100, value:1000, cost:800});
    eq(rows[1], {snapshot_date:"2026-08-13", name:"現金", code:null,
                 broker:null, acct:null, cat:null, qty:null, value:500, cost:400});
  });
});

test("sbSaveSnapshot: upsertが失敗したら後続を実行せずfalseを返す", async()=>{
  await withEnv(CFG, [{ok:false, status:500}], async(mf)=>{
    eq(await sbSaveSnapshot(SNAP), false);
    eq(mf.calls.length, 1);
    eq(statText(), "DB同期失敗");
  });
});

test("sbSaveSnapshot: DELETEが失敗したらINSERTせずfalseを返す", async()=>{
  await withEnv(CFG, [{}, {ok:false, status:500}], async(mf)=>{
    eq(await sbSaveSnapshot(SNAP), false);
    eq(mf.calls.length, 2);
    eq(statText(), "DB同期失敗");
  });
});

test("sbSaveSnapshot: 成功するとステータスがDB同期済になる", async()=>{
  await withEnv(CFG, [{}, {}, {}], async()=>{
    await sbSaveSnapshot(SNAP);
    eq(statText(), "DB同期済");
  });
});

test("sbSaveSnapshot: 明細が空ならINSERTを出さない", async()=>{
  await withEnv(CFG, [{}, {}], async(mf)=>{
    eq(await sbSaveSnapshot({date:"2026-08-13", total:0, cost:0, rows:[]}), true);
    eq(mf.calls.length, 2);
  });
});

test("sbSaveSnapshot: 設定が無ければfetchを呼ばずfalseを返す", async()=>{
  await withEnv(undefined, [], async(mf)=>{
    eq(await sbSaveSnapshot(SNAP), false);
    eq(mf.calls.length, 0);
  });
});

test("sbSaveSnapshot: fetchがthrowしても例外を投げずfalseを返す", async()=>{
  await withEnv(CFG, [{throw:"network down"}], async()=>{
    eq(await sbSaveSnapshot(SNAP), false);
    eq(statText(), "DB同期失敗");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

ブラウザで再読込する。

期待: `10 FAILED / 13 passed`。すべて `sbSaveSnapshot is not defined`。

- [ ] **Step 3: sbSaveSnapshot を実装する**

`supabase.js` の `sbLoadHistory` の**直後**に、以下を挿入する。

```js
  // スナップショットと保有明細を保存する。
  // FK制約があるので snapshots upsert → holdings DELETE → holdings INSERT の順は必須。
  async function sbSaveSnapshot(snap){
    if(!sbEnabled()) return false;
    const date=snap.date;

    const up=await sbFetch("snapshots", {
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:{
        snapshot_date:date,
        total_value:snap.total,
        total_cost:snap.cost,
        updated_at:new Date().toISOString()   // default now() はUPDATE時に再適用されないので明示する
      }
    });
    if(!up){ sbStatus("error"); return false; }

    // 差分を取らず、その日の明細を消してから入れ直す（銘柄の増減を考えずに済む）
    const del=await sbFetch("holdings?snapshot_date=eq."+date, {
      method:"DELETE",
      headers:{"Prefer":"return=minimal"}
    });
    if(!del){ sbStatus("error"); return false; }

    const rows=(snap.rows||[]).map(r=>({
      snapshot_date:date,
      name:r.name,
      code:r.code||null,
      broker:r.broker||null,
      acct:r.acct||null,
      cat:r.cat||null,
      qty:(r.qty===undefined||r.qty===null)?null:r.qty,
      value:r.value,
      cost:r.cost
    }));
    if(rows.length){
      const ins=await sbFetch("holdings", {
        method:"POST",
        headers:{"Prefer":"return=minimal"},
        body:rows
      });
      if(!ins){ sbStatus("error"); return false; }
    }

    sbStatus("ok");
    return true;
  }
```

公開部分に1行追加する。

```js
  window.sbSaveSnapshot=sbSaveSnapshot;
```

- [ ] **Step 4: テストを実行して通ることを確認する**

ブラウザで再読込する。

期待: `ALL PASS (23)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbSaveSnapshot を実装（スナップショットと明細の保存）"
```

---

### Task 4: sbDeleteDay と sbDeleteAll

**Files:**
- Modify: `supabase.js`
- Modify: `test/supabase.test.html`

- [ ] **Step 1: 失敗するテストを書く**

`test/supabase.test.html` の `// === /tests ===` の**直前**に、以下を追加する。

```js
test("sbDeleteDay: 指定日のsnapshotsをDELETEする", async()=>{
  await withEnv(CFG, [{}], async(mf)=>{
    eq(await sbDeleteDay("2026-08-13"), true);
    eq(mf.calls[0].method, "DELETE");
    eq(mf.calls[0].url, "https://demo.supabase.co/rest/v1/snapshots?snapshot_date=eq.2026-08-13");
    eq(mf.calls[0].headers["Prefer"], "return=minimal");
  });
});

test("sbDeleteAll: 無条件DELETEを避けるためフィルタを付ける", async()=>{
  await withEnv(CFG, [{}], async(mf)=>{
    eq(await sbDeleteAll(), true);
    eq(mf.calls[0].method, "DELETE");
    eq(mf.calls[0].url, "https://demo.supabase.co/rest/v1/snapshots?snapshot_date=gt.1900-01-01");
  });
});

test("sbDeleteAll: 失敗したらfalseを返しステータスが失敗になる", async()=>{
  await withEnv(CFG, [{ok:false, status:500}], async()=>{
    eq(await sbDeleteAll(), false);
    eq(statText(), "DB同期失敗");
  });
});

test("sbDeleteDay/sbDeleteAll: 設定が無ければfetchを呼ばずfalseを返す", async()=>{
  await withEnv(undefined, [], async(mf)=>{
    eq(await sbDeleteDay("2026-08-13"), false);
    eq(await sbDeleteAll(), false);
    eq(mf.calls.length, 0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

ブラウザで再読込する。

期待: `4 FAILED / 23 passed`。すべて `sbDeleteDay is not defined` / `sbDeleteAll is not defined`。

- [ ] **Step 3: 削除関数を実装する**

`supabase.js` の `sbSaveSnapshot` の**直後**に、以下を挿入する。

```js
  // 指定日のスナップショットを削除する（holdingsはcascadeで消える）
  async function sbDeleteDay(date){
    if(!sbEnabled()) return false;
    const res=await sbFetch("snapshots?snapshot_date=eq."+date, {
      method:"DELETE",
      headers:{"Prefer":"return=minimal"}
    });
    sbStatus(res?"ok":"error");
    return !!res;
  }

  // 全スナップショットを削除する。PostgRESTは無条件DELETEを拒否するのでフィルタを付ける
  async function sbDeleteAll(){
    if(!sbEnabled()) return false;
    const res=await sbFetch("snapshots?snapshot_date=gt.1900-01-01", {
      method:"DELETE",
      headers:{"Prefer":"return=minimal"}
    });
    sbStatus(res?"ok":"error");
    return !!res;
  }
```

公開部分に2行追加する。

```js
  window.sbDeleteDay=sbDeleteDay;
  window.sbDeleteAll=sbDeleteAll;
```

- [ ] **Step 4: テストを実行して通ることを確認する**

ブラウザで再読込する。

期待: `ALL PASS (27)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbDeleteDay と sbDeleteAll を実装"
```

---

### Task 5: 設定ファイルの雛形とHTML/CSSの配線

**Files:**
- Create: `supabase-config.example.js`
- Modify: `portfolio_app.html:99-104`（カードヘッダ）と `portfolio_app.html:125-126`（script）
- Modify: `style.css:264` の直後

このタスクにテストは無い。配線だけで、振る舞いはTask 6で入る。

- [ ] **Step 1: 設定ファイルの雛形を作る**

`supabase-config.example.js` を新規作成する。

```js
// このファイルを supabase-config.js にコピーして、値を埋めてください。
// supabase-config.js は .gitignore 対象です。絶対にコミットしないでください。
// 値は Supabase の Project Settings → API から取得できます。
window.SUPABASE_CONFIG = {
  url: "",   // 例: https://xxxxxxxxxxxx.supabase.co
  key: ""    // anon public key
};
```

- [ ] **Step 2: HTMLにステータス表示欄を足す**

`portfolio_app.html` の資産推移カードのヘッダ（101〜104行目）を、次のように書き換える。

変更前:
```html
      <div class="card-title">
        <span>資産推移 <small id="histInfo"></small></span>
        <button class="hist-clear" id="histClear" title="推移の記録をすべて削除">履歴クリア</button>
      </div>
```

変更後:
```html
      <div class="card-title">
        <span>資産推移 <small id="histInfo"></small><small id="dbStat" class="dbstat"></small></span>
        <button class="hist-clear" id="histClear" title="推移の記録をすべて削除">履歴クリア</button>
      </div>
```

- [ ] **Step 3: HTMLにスクリプトを足し、キャッシュバスターを更新する**

`portfolio_app.html` 末尾（125〜126行目）を書き換える。

変更前:
```html
<script src="sectors.js?v=20260722f"></script>
<script src="app.js?v=20260722f"></script>
```

変更後:
```html
<script src="sectors.js?v=20260813a"></script>
<script src="supabase-config.js"></script>
<script src="supabase.js?v=20260813a"></script>
<script src="app.js?v=20260813a"></script>
```

`supabase-config.js` はバージョン指定を付けない（存在しないこともあり、その場合も読み込み失敗はページを壊さないため）。

同じファイル10行目のCSS参照も揃える。

変更前:
```html
<link rel="stylesheet" href="style.css?v=20260722f">
```

変更後:
```html
<link rel="stylesheet" href="style.css?v=20260813a">
```

- [ ] **Step 4: CSSを足す**

`style.css` の `#histInfo{margin-left:10px;}`（264行目）の**直後**に、以下を挿入する。

```css
  #dbStat{margin-left:10px;font-size:11.5px;font-weight:600;}
  #dbStat.unset{color:var(--muted);opacity:.65;}
  #dbStat.ok{color:#6fcf97;}
  #dbStat.error{color:#ff8a8a;}
```

- [ ] **Step 5: 画面を開いて表示を確認する**

`portfolio_app.html` をブラウザで開く。`supabase-config.js` はまだ無い状態。

期待:
- 資産推移カードのヘッダに `DB未設定` が薄いグレーで表示される
- ブラウザのコンソールに `supabase-config.js` の404が出るが、他のエラーは無い
- CSV読込・推移グラフなど既存の動作がこれまで通り動く

- [ ] **Step 6: コミット**

```bash
git add supabase-config.example.js portfolio_app.html style.css && git commit -m "設定ファイル雛形とステータス表示欄を追加"
```

---

### Task 6: app.js に4つのフックを差す

**Files:**
- Modify: `app.js:858-868`（`saveSnapshot`）
- Modify: `app.js:1023-1029`（履歴クリア）
- Modify: `app.js:1066-1071`（`delHistoryDay`）
- Modify: `app.js:1089-1090`（起動時）

このタスクも自動テストは無い（DOM・localStorage・実ファイルに強く依存するため）。Step 5の手順で確認する。

- [ ] **Step 1: 保存フックを差す**

`app.js` の `saveSnapshot` を書き換える。

変更前:
```js
function saveSnapshot(dateStr){
  if(!RAW.length) return;
  const total=RAW.reduce((s,d)=>s+d.value,0);
  const cost =RAW.reduce((s,d)=>s+d.cost,0);
  const day=dateStr||isoLocal();
  const hist=loadHist().filter(h=>h.date!==day);   // 同日の記録は上書き
  hist.push({date:day,total,cost});
  hist.sort((a,b)=>a.date.localeCompare(b.date));
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(hist)); }catch{}
  renderHistory();
}
```

変更後:
```js
function saveSnapshot(dateStr){
  if(!RAW.length) return;
  const total=RAW.reduce((s,d)=>s+d.value,0);
  const cost =RAW.reduce((s,d)=>s+d.cost,0);
  const day=dateStr||isoLocal();
  const hist=loadHist().filter(h=>h.date!==day);   // 同日の記録は上書き
  hist.push({date:day,total,cost});
  hist.sort((a,b)=>a.date.localeCompare(b.date));
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(hist)); }catch{}
  renderHistory();
  sbSaveSnapshot({date:day,total,cost,rows:RAW});   // DB保存は待たない（描画をネットワークに引きずられないため）
}
```

- [ ] **Step 2: 削除フックを2か所に差す**

履歴クリア（1023〜1029行目）を書き換える。

変更前:
```js
document.getElementById("histClear").addEventListener("click",()=>{
  if(!loadHist().length) return;
  if(confirm("資産推移の記録をすべて削除しますか？")){
    localStorage.removeItem(HIST_KEY);
    renderHistory();
  }
});
```

変更後:
```js
document.getElementById("histClear").addEventListener("click",()=>{
  if(!loadHist().length) return;
  if(confirm("資産推移の記録をすべて削除しますか？（Supabaseの記録も削除されます）")){
    localStorage.removeItem(HIST_KEY);
    renderHistory();
    sbDeleteAll();
  }
});
```

`delHistoryDay`（1066〜1071行目）を書き換える。

変更前:
```js
function delHistoryDay(day){
  const h=loadHist();
  if(!h.some(x=>x.date===day)) return false;
  localStorage.setItem(HIST_KEY, JSON.stringify(h.filter(x=>x.date!==day)));
  return true;
}
```

変更後:
```js
function delHistoryDay(day){
  const h=loadHist();
  if(!h.some(x=>x.date===day)) return false;
  localStorage.setItem(HIST_KEY, JSON.stringify(h.filter(x=>x.date!==day)));
  sbDeleteDay(day);
  return true;
}
```

- [ ] **Step 3: 起動時の読み戻しを差す**

`app.js` の末尾（1089〜1090行目）を書き換える。

変更前:
```js
// 初期表示は空（推移は保存済みの記録を表示）
setData([]);
renderHistory();
```

変更後:
```js
// 初期表示は空（推移は保存済みの記録を表示）
setData([]);
renderHistory();

// Supabaseから資産推移を読み戻す。localStorageは同期キャッシュ扱いで、
// 取得できたらその内容で置き換えて描画し直す。ステータス表示は supabase.js 側が更新する。
(async function hydrateFromDB(){
  if(!sbEnabled()) return;          // 未設定時は supabase.js 側で「DB未設定」表示済み
  const rows=await sbLoadHistory();
  if(!rows||!rows.length) return;   // 取得失敗、またはDBが空 → localStorageの内容を残す
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(rows)); }catch{}
  renderHistory();
})();
```

- [ ] **Step 4: 単体テストがまだ通ることを確認する**

`test/supabase.test.html` をブラウザで再読込する。

期待: `ALL PASS (27)`（`app.js` は読み込んでいないので影響しないはずだが、念のため）

- [ ] **Step 5: Supabase未設定でも壊れないことを確認する**

`supabase-config.js` が無い状態で `portfolio_app.html` をブラウザで開き、`demo/SBI国内_demo.csv` を読み込む。

期待:
- ドーナツと銘柄一覧が表示される
- ヘッダに `デモ（推移に記録しません）` が出る
- ステータスは `DB未設定` のまま
- コンソールに `supabase-config.js` の404以外のエラーが出ない

- [ ] **Step 6: コミット**

```bash
git add app.js && git commit -m "app.js からSupabaseの保存・読み戻し・削除を呼ぶ"
```

---

### Task 7: READMEの更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: ファイル構成の表に3行足す**

`README.md` の「ファイル構成」の表を書き換える。

変更前:
```markdown
| ファイル | 内容 |
|---------|------|
| `portfolio_app.html` | 画面の骨組み |
| `style.css` | スタイル |
| `app.js` | ロジック（CSVパース・チャート描画・資産推移） |

3ファイルを同じフォルダに置いて使います。
```

変更後:
```markdown
| ファイル | 内容 |
|---------|------|
| `portfolio_app.html` | 画面の骨組み |
| `style.css` | スタイル |
| `app.js` | ロジック（CSVパース・チャート描画・資産推移） |
| `sectors.js` | 銘柄のセクター分類 |
| `supabase.js` | Supabaseへの保存・読み込み（任意） |
| `supabase-config.js` | Supabaseの接続情報（任意・git管理外） |

同じフォルダに置いて使います。Supabase連携を使わない場合は最初の4ファイルだけで動きます。
```

- [ ] **Step 2: Supabase連携の節を追加する**

`README.md` の「プライバシー」の節の**直前**に、以下を挿入する。

````markdown
## Supabase連携（任意）

資産推移と保有明細をSupabase（PostgreSQL）に保存すると、ブラウザのデータを消しても記録が残り、別のPCからも同じ推移を見られます。設定しなければ従来通りブラウザ内だけで完結します。

### セットアップ

1. [Supabase](https://supabase.com/) でプロジェクトを作成する
2. SQL Editor で以下を実行する

```sql
create table snapshots (
  snapshot_date date primary key,
  total_value   numeric not null,
  total_cost    numeric not null,
  updated_at    timestamptz not null default now()
);

create table holdings (
  id            bigint generated always as identity primary key,
  snapshot_date date not null references snapshots(snapshot_date) on delete cascade,
  name          text   not null,
  code          text,
  broker        text,
  acct          text,
  cat           text,
  qty           numeric,
  value         numeric not null,
  cost          numeric not null
);

create index holdings_date_idx on holdings (snapshot_date);

alter table snapshots enable row level security;
alter table holdings  enable row level security;

create policy "anon all" on snapshots for all to anon using (true) with check (true);
create policy "anon all" on holdings  for all to anon using (true) with check (true);
```

3. Project Settings → API から Project URL と anon public key をコピーする
4. `supabase-config.example.js` を `supabase-config.js` にコピーし、値を貼り付ける
5. `portfolio_app.html` を開き、資産推移カードに `DB同期済` と出れば接続完了

### 挙動

- CSVを読み込むたびに、その日のスナップショット（日付・資産残高・元本）と保有明細の全銘柄が保存されます。同じ日付を読み直すと上書きされます
- 起動時にDBから資産推移を読み戻します。DBが空のときはブラウザの記録を残します
- ポートフォリオ（ドーナツ・銘柄一覧）は起動時は空です。保有明細はDBに保存されますが読み戻しません
- 「履歴クリア」はSupabaseの記録も削除します

### 注意

`supabase-config.js` は `.gitignore` 対象です。**このファイルをコミットしないでください。** 認証を使わない構成のため、anonキーが漏れると誰でもデータを読み書きできます。別のPCで使うときは手動でファイルを配置してください。
````

- [ ] **Step 3: プライバシーの節を実態に合わせる**

`README.md` のプライバシーの節を書き換える。

変更前:
```markdown
- すべての処理はブラウザ内で完結します。外部サーバーへの通信は行いません（Webフォントの読み込みを除く）
- 資産推移の記録はブラウザのlocalStorageに保存されます。「履歴クリア」ボタンでいつでも削除できます
```

変更後:
```markdown
- Supabaseを設定しない場合、すべての処理はブラウザ内で完結します。外部サーバーへの通信は行いません（Webフォントの読み込みを除く）
- Supabaseを設定した場合のみ、資産推移と保有明細が自分のSupabaseプロジェクトへ送信されます
- 資産推移の記録はブラウザのlocalStorageに保存されます。「履歴クリア」ボタンでいつでも削除できます
```

- [ ] **Step 4: 表示を確認する**

`README.md` をエディタのMarkdownプレビュー、またはGitHub上の差分で見て、表とコードブロックが崩れていないことを確認する。

- [ ] **Step 5: コミット**

```bash
git add README.md && git commit -m "READMEにSupabase連携のセットアップ手順を追記"
```

---

### Task 8: 実DBでの結合確認

**Files:**
- Create: `supabase-config.js`（git管理外）

このタスクはSupabaseプロジェクトの作成を伴うため、ユーザー本人が実施する。エージェントが実行する場合はここで停止し、ユーザーに引き渡すこと。

- [ ] **Step 1: Supabaseプロジェクトを作り、DDLを流す**

README の「Supabase連携（任意）」の手順1〜2を実施する。Table Editor に `snapshots` と `holdings` が現れることを確認する。

- [ ] **Step 2: 接続情報を配置する**

```bash
cp supabase-config.example.js supabase-config.js
```

`supabase-config.js` に Project URL と anon key を書き込む。

```bash
git status --short
```
期待: `supabase-config.js` が現れないこと（gitignoreが効いている）。

- [ ] **Step 3: 実データを1日分読み込む**

`portfolio_app.html` を開き、実データのCSVを読み込む。

期待:
- ステータスが `DB同期済` になる
- Supabaseの Table Editor で `snapshots` に1行、`holdings` に銘柄数分の行が入っている
- `holdings` の `broker` / `acct` / `cat` / `qty` が正しく入っている

- [ ] **Step 4: 同じ日付を読み直して重複しないことを確認する**

同じCSVをもう一度読み込む。

期待: `snapshots` は1行のまま、`holdings` の行数も変わらない。

- [ ] **Step 5: localStorageを消して復元を確認する**

ブラウザの開発者ツールで `localStorage.removeItem("kabu_asset_history_v1")` を実行し、ページを再読込する。

期待: 資産推移グラフがDBの内容で表示される。

- [ ] **Step 6: 設定を外しても動くことを確認する**

`supabase-config.js` を一時的にリネームしてページを開く。

期待: ステータスが `DB未設定`。CSV読込・グラフ描画は従来通り動く。確認後、ファイル名を戻す。

- [ ] **Step 7: 履歴クリアを確認する**

「履歴クリア」を実行する。

期待: 確認ダイアログに「Supabaseの記録も削除されます」と出る。実行後、`snapshots` と `holdings` の両方が空になる。

- [ ] **Step 8: ブランチを仕上げる**

すべて確認できたら、superpowers:finishing-a-development-branch スキルでマージ方法を決める。

---

## 完了の定義

- `test/supabase.test.html` が `ALL PASS (27)` を表示する
- `supabase-config.js` が無い状態でも、アプリが従来通り動作する
- Supabaseを設定した状態で、CSV読込 → DBに保存 → localStorage削除 → 再読込で推移が復元される
- `git status` に `supabase-config.js` が現れない
