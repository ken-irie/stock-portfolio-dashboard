# 過去日ポートフォリオ表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セクション見出しに日付セレクタを置き、選んだ日の保有明細をSupabaseから復元してドーナツ・銘柄一覧に表示する。起動時はDBの最新日を自動表示する。

**Architecture:** `supabase.js` に `sbLoadHoldings(date)` を追加し、戻り値を既存の `setData()` にそのまま渡す。明細の有無は `snapshots.holdings_count` で判別し、追加クエリを発生させない。日付切り替えは都度取得（キャッシュなし）で、連番により古い応答が新しい表示を上書きしないようにする。

**Tech Stack:** バニラJS（ビルドなし・依存なし）、Supabase（PostgREST REST API）、ブラウザで開くだけの自作テストページ

**Spec:** `docs/superpowers/specs/2026-08-13-past-date-portfolio-design.md`

**Branch:** `past-date-portfolio`（作成済み。設計書はコミット済み）

---

## テストの実行方法

`test/supabase.test.html` は相対パスで `../supabase.js` を読むため、`file://` で直接開いても動かない。ローカルHTTPサーバー経由で開く。

```
preview_start { name: "portfolio-local" }        # C:\work\02_programs\12_kabu をポート8734で配信
tabs_create
navigate      { url: "http://localhost:8734/test/supabase.test.html?v=p1a", tabId: "<new>", force: true }
get_page_text { tabId: "<new>" }
```

**キャッシュに注意。** `.js` を編集した直後は古いコードが動くことがある。HTMLのクエリ文字列を変えても `.js` は別途キャッシュされる。**再実行のたびに `tabs_create` で新しいタブを開き、クエリ文字列も変え、`force: true` を付けること。** 結果が変わらないときは、まず実行中のコードが編集後のものか疑う（`sbLoadHoldings` の有無などをページ内で確認できる）。

`portfolio_app.html` の検証も同じサーバー経由で行う。ただし `supabase-config.js` には**本番の認証情報が入っている**ため、そのまま開いてCSVを読み込むとテストデータが本番DBに書き込まれる。**必ず後述のiframeハーネスを使い、偽のエンドポイントに差し替えて検証すること。**

## 前提

- 作業ブランチ `past-date-portfolio` にいること（`git branch --show-current` で確認）
- 既存のユニットテストは **29件** 全て通る状態から始まる
- **Task 1（DDL適用）は他のすべてのタスクをブロックする。** 先に完了させること

## 設計書に無い決定（実装時に判明した点）

1. **空表示メッセージを変数化する** — `app.js:581` に既存の空表示メッセージがある。DOMを後から書き換えるのではなく、この既存の描画経路に変数を通す。描画箇所を二重に持たないため
2. **`saveSnapshot` が積む履歴に `n` を含める** — CSV読込後にセレクタを作り直す際、その日のエントリに件数が無いと誤って「（明細なし）」と表示されてしまう
3. **CSV読込とリセットでも `showSeq` を進める** — 連番ガードは日付セレクタ同士の競合しか防がない。読み戻し中にCSVを読み込むと、遅れて返った `showDate` の結果がCSVの表示を上書きしうる。同じ仕組みで塞ぐ

## ファイル構成

| ファイル | 扱い | 変更内容 |
|---|---|---|
| `supabase.js` | 変更 | `sbLoadHistory` に `n` を追加、`sbSaveSnapshot` に `holdings_count` を追加、`sbLoadHoldings` を新規追加（公開6関数 → 7関数） |
| `test/supabase.test.html` | 変更 | 既存2件を修正し、8件を追加（29件 → 37件） |
| `portfolio_app.html` | 変更 | セクション見出しに `<select id="dateSel">` を追加 |
| `style.css` | 変更 | `.datesel` のスタイルを追加 |
| `app.js` | 変更 | 空表示メッセージの変数化、`buildDateSelector` / `showDate` / `applyDateView` の追加、起動時・CSV読込・リセットへの統合 |
| `README.md` | 変更 | DDLに `holdings_count` を追加、挙動の節を更新 |
| `docs/superpowers/specs/2026-08-13-supabase-portfolio-sync-design.md` | 変更 | スキーマ定義に `holdings_count` を追記 |

---

### Task 1: スキーマに holdings_count を追加（ユーザー作業・ブロッキング）

**Files:** なし（Supabase側の操作）

このタスクは**必ず最初に完了させること。** Task 3以降のコードは upsert の body に `holdings_count` を含めるため、列が存在しないとPostgRESTが400を返し、**CSV読込時の保存が失敗するようになる。**

エージェントはSupabaseのSQLを実行できない。ここで停止し、ユーザーに実施を依頼すること。

- [ ] **Step 1: SQL Editorで列を追加する**

Supabaseダッシュボード → SQL Editor で以下を実行する。

```sql
alter table snapshots add column holdings_count integer not null default 0;

-- 既存の行を実際の明細件数で埋め直す
update snapshots s
set holdings_count = (select count(*) from holdings h where h.snapshot_date = s.snapshot_date);
```

- [ ] **Step 2: 結果を確認する**

SQL Editorで以下を実行する。

```sql
select snapshot_date, total_value, holdings_count from snapshots order by snapshot_date;
```

期待: 12行が返り、`holdings_count` が以下と一致すること。

| snapshot_date | holdings_count |
|---|---|
| 2026-06-28 / 07-09 / 07-12 / 07-13 / 07-16 | 39 |
| 2026-07-21 / 07-22 / 07-25 | 41 |
| 2026-08-03 / 08-07 / 08-12 | 0 |
| 2026-08-13 | 41 |

一致しない場合は先に進まず、実際の値を報告すること。

---

### Task 2: sbLoadHistory に holdings_count を通す

**Files:**
- Modify: `supabase.js`（`sbLoadHistory`）
- Modify: `test/supabase.test.html`（既存2件の修正＋1件追加）

- [ ] **Step 1: 既存テスト2件を修正し、新しいテストを1件足す**

`test/supabase.test.html` の既存テスト **「sbLoadHistory: 取得結果を{date,total,cost}の配列に変換する」** を、次の内容にまるごと置き換える。

```js
test("sbLoadHistory: 取得結果を{date,total,cost,n}の配列に変換する", async()=>{
  const body=[{snapshot_date:"2026-08-01", total_value:"1000", total_cost:"800", holdings_count:39},
              {snapshot_date:"2026-08-02", total_value:"1100", total_cost:"800", holdings_count:0}];
  await withEnv(CFG, [{body}], async()=>{
    const r=await sbLoadHistory();
    eq(r, [{date:"2026-08-01", total:1000, cost:800, n:39},
           {date:"2026-08-02", total:1100, cost:800, n:0}]);
    eq(statText(), "DB同期済");
  });
});
```

既存テスト **「sbLoadHistory: URLに日付昇順のクエリが付く」** の中の期待URLを、次の1行に差し替える（`holdings_count` が増えるだけ）。

```js
    eq(mf.calls[0].url,
       "https://demo.supabase.co/rest/v1/snapshots?select=snapshot_date,total_value,total_cost,holdings_count&order=snapshot_date.asc");
```

さらに `// === /tests ===` の**直前**に、以下を追加する。

```js
test("sbLoadHistory: holdings_countが無い行はn=0になる", async()=>{
  const body=[{snapshot_date:"2026-08-01", total_value:"1000", total_cost:"800"}];
  await withEnv(CFG, [{body}], async()=>{
    eq(await sbLoadHistory(), [{date:"2026-08-01", total:1000, cost:800, n:0}]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

期待: `3 FAILED / 27 passed`。修正した2件と新規1件が落ちる。

- [ ] **Step 3: sbLoadHistory を変更する**

`supabase.js` の `sbLoadHistory` を、次の内容にまるごと置き換える。

```js
  // 資産推移を取得する。失敗はnull、DBが空なら空配列（app.js側で区別する）
  // n は保有明細の件数。0 は「金額はあるが明細が記録されていない日」を意味する。
  async function sbLoadHistory(){
    if(!sbEnabled()) return null;   // 未設定時は「DB未設定」表示のままにする
    const res=await sbFetch("snapshots?select=snapshot_date,total_value,total_cost,holdings_count&order=snapshot_date.asc");
    if(!res){ sbStatus("error"); return null; }
    try{
      const rows=await res.json();
      if(!Array.isArray(rows)){ sbStatus("error"); return null; }
      sbStatus("ok");
      return rows.map(r=>({
        date:r.snapshot_date,
        total:Number(r.total_value),
        cost:Number(r.total_cost),
        n:Number(r.holdings_count)||0
      }));
    }catch(e){
      console.warn("[supabase] failed to parse history", e);
      sbStatus("error");
      return null;
    }
  }
```

- [ ] **Step 4: テストを実行して通ることを確認する**

期待: `ALL PASS (30)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbLoadHistory が保有明細の件数を返すようにする"
```

---

### Task 3: sbSaveSnapshot に holdings_count を含める

**Files:**
- Modify: `supabase.js`（`sbSaveSnapshot`）
- Modify: `test/supabase.test.html`（2件追加）

明細件数をupsertに含めるには、件数を先に知る必要がある。現在は明細配列をupsertの後に組み立てているため、**組み立てを関数の冒頭へ移す。** リクエストの順序（upsert → 明細DELETE → 明細INSERT）は変えない。

- [ ] **Step 1: 失敗するテストを書く**

`test/supabase.test.html` の `// === /tests ===` の**直前**に、以下を追加する。

```js
test("sbSaveSnapshot: upsertのbodyのholdings_countが明細件数と一致する", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    await sbSaveSnapshot(SNAP);
    eq(JSON.parse(mf.calls[0].body).holdings_count, 2);
  });
});

test("sbSaveSnapshot: 不正な行があるときは1度も通信せずfalseを返す", async()=>{
  await withEnv(CFG, [{}, {}, {}], async(mf)=>{
    eq(await sbSaveSnapshot({date:"2026-08-13", total:1, cost:1, rows:[null]}), false);
    eq(mf.calls.length, 0);
    eq(statText(), "DB同期失敗");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

期待: `2 FAILED / 30 passed`。1件目は `holdings_count` が `undefined` で落ち、2件目は通信回数が3ではなく0であることを要求して落ちる。

- [ ] **Step 3: sbSaveSnapshot を変更する**

`supabase.js` の `sbSaveSnapshot` を、次の内容にまるごと置き換える。

```js
  // スナップショットと保有明細を保存する。
  // FK制約があるので snapshots upsert → holdings DELETE → holdings INSERT の順は必須。
  async function sbSaveSnapshot(snap){
    if(!snap) return false;
    if(!sbEnabled()) return false;
    const date=snap.date;

    // 件数をupsertに含めるため、明細の組み立てを先に済ませる
    let rows;
    try{
      rows=(snap.rows||[]).map(r=>({
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
    }catch(e){
      console.warn("[supabase] invalid holdings row", e);
      sbStatus("error");
      return false;
    }

    const up=await sbFetch("snapshots", {
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:{
        snapshot_date:date,
        total_value:snap.total,
        total_cost:snap.cost,
        holdings_count:rows.length,
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

- [ ] **Step 4: テストを実行して通ることを確認する**

期待: `ALL PASS (32)`。既存のリクエスト順序テストとPreferヘッダのテストも通ったままであること。

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbSaveSnapshot が保有明細の件数を記録するようにする"
```

---

### Task 4: sbLoadHoldings を追加

**Files:**
- Modify: `supabase.js`
- Modify: `test/supabase.test.html`（5件追加）

- [ ] **Step 1: 失敗するテストを書く**

`test/supabase.test.html` の `// === /tests ===` の**直前**に、以下を追加する。

```js
test("sbLoadHoldings: 指定日のURLとselect句が正しい", async()=>{
  await withEnv(CFG, [{body:[]}], async(mf)=>{
    await sbLoadHoldings("2026-08-13");
    eq(mf.calls.length, 1);
    eq(mf.calls[0].method, "GET");
    eq(mf.calls[0].url,
       "https://demo.supabase.co/rest/v1/holdings?snapshot_date=eq.2026-08-13&select=name,code,broker,acct,cat,qty,value,cost");
  });
});

test("sbLoadHoldings: RAWと同じ形の配列に変換する", async()=>{
  const body=[{name:"トヨタ自動車", code:"7203", broker:"SBI", acct:"特定", cat:"jp", qty:"100", value:"1000", cost:"800"},
              {name:"現金", code:null, broker:null, acct:null, cat:null, qty:null, value:"500", cost:"400"}];
  await withEnv(CFG, [{body}], async()=>{
    eq(await sbLoadHoldings("2026-08-13"),
       [{name:"トヨタ自動車", code:"7203", broker:"SBI", acct:"特定", cat:"jp", qty:100, value:1000, cost:800},
        {name:"現金", code:"", broker:"", acct:"", cat:"", qty:0, value:500, cost:400}]);
  });
});

test("sbLoadHoldings: 4xxならnullを返す", async()=>{
  await withEnv(CFG, [{ok:false, status:401}], async()=>{
    eq(await sbLoadHoldings("2026-08-13"), null);
    eq(statText(), "DB同期失敗");
  });
});

test("sbLoadHoldings: 設定が無ければfetchを呼ばずnullを返す", async()=>{
  await withEnv(undefined, [], async(mf)=>{
    eq(await sbLoadHoldings("2026-08-13"), null);
    eq(mf.calls.length, 0);
  });
});

test("sbLoadHoldings: 空配列とnullを区別できる", async()=>{
  await withEnv(CFG, [{body:[]}], async()=>{
    eq(await sbLoadHoldings("2026-08-13"), []);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

期待: `5 FAILED / 32 passed`。すべて `sbLoadHoldings is not defined`。

- [ ] **Step 3: sbLoadHoldings を実装する**

`supabase.js` の `sbLoadHistory` の**直後**に、以下を挿入する。

```js
  // 指定日の保有明細を取得する。戻り値は RAW と同じ形なので setData() にそのまま渡せる。
  // 欠損は "" と 0 に寄せる（CSVパーサーの出力と形を揃えるため）。
  async function sbLoadHoldings(date){
    if(!sbEnabled()) return null;
    const res=await sbFetch("holdings?snapshot_date=eq."+date+"&select=name,code,broker,acct,cat,qty,value,cost");
    if(!res){ sbStatus("error"); return null; }
    try{
      const rows=await res.json();
      if(!Array.isArray(rows)){ sbStatus("error"); return null; }
      sbStatus("ok");
      return rows.map(r=>({
        name:r.name,
        code:r.code||"",
        broker:r.broker||"",
        acct:r.acct||"",
        cat:r.cat||"",
        qty:Number(r.qty)||0,
        value:Number(r.value),
        cost:Number(r.cost)
      }));
    }catch(e){
      console.warn("[supabase] failed to parse holdings", e);
      sbStatus("error");
      return null;
    }
  }
```

公開部分に1行追加する。`window.sbLoadHistory=sbLoadHistory;` の直後に置くこと。

```js
  window.sbLoadHoldings=sbLoadHoldings;
```

- [ ] **Step 4: テストを実行して通ることを確認する**

期待: `ALL PASS (37)`

- [ ] **Step 5: コミット**

```bash
git add supabase.js test/supabase.test.html && git commit -m "sbLoadHoldings を追加（指定日の保有明細を取得）"
```

---

### Task 5: 日付セレクタのHTMLとCSS

**Files:**
- Modify: `portfolio_app.html:35`
- Modify: `style.css`（`.sec-head .accent` のルールの直後）

このタスクに自動テストは無い。挙動はTask 6・7で入る。ここでは見た目の配線だけ行う。

- [ ] **Step 1: セクション見出しにセレクタを足す**

`portfolio_app.html` の35行目を書き換える。

変更前:
```html
  <div class="sec-head">資産ポートフォリオ (全て) <span class="accent">評価額順 [降順]</span></div>
```

変更後:
```html
  <div class="sec-head">資産ポートフォリオ (全て)
    <select id="dateSel" class="datesel" title="表示する日付を選ぶ" hidden></select>
    <span class="accent">評価額順 [降順]</span></div>
```

`hidden` を付けておくのは、Supabase未設定のときに何も出さないため。`buildDateSelector` が外す。

- [ ] **Step 2: CSSを足す**

`style.css` の `.sec-head .accent{...}` のルール（82行目で終わる）の**直後**に、以下を挿入する。

```css
  .datesel{
    background:var(--panel-2);border:1px solid var(--line);color:#e8ebf2;
    font-family:inherit;font-size:12.5px;font-weight:700;letter-spacing:.02em;
    padding:5px 10px;border-radius:8px;cursor:pointer;
  }
  .datesel:hover{border-color:rgba(227,196,119,.45);}
  .datesel:focus{outline:none;border-color:var(--gold);}
```

- [ ] **Step 3: キャッシュバスターを更新する**

`portfolio_app.html` の `?v=20260813a` を4か所すべて `?v=20260814a` に変える（10行目の `style.css`、末尾の `sectors.js` / `supabase.js` / `app.js`）。`supabase-config.js` にはバージョンを付けないままにする。

- [ ] **Step 4: 表示を確認する**

サーバーを起動し、新しいタブで `http://localhost:8734/portfolio_app.html?v=t5a` を `force: true` で開く。

期待:
- セレクタは**表示されない**（`hidden` のまま。`buildDateSelector` はまだ無い）
- 既存の表示が崩れていない
- コンソールに新しいエラーが出ていない

`javascript_tool` で以下を評価し、要素が存在することを確認する。

```js
JSON.stringify({exists: !!document.getElementById('dateSel'), hidden: document.getElementById('dateSel').hidden})
```

期待: `{"exists":true,"hidden":true}`

- [ ] **Step 5: コミット**

```bash
git add portfolio_app.html style.css && git commit -m "日付セレクタの要素とスタイルを追加"
```

---

### Task 6: app.js に表示切り替えの中身を作る

**Files:**
- Modify: `app.js`（空表示メッセージの変数化、状態変数、`buildDateSelector` / `applyDateView` / `showDate` の追加）

このタスクでは関数を用意するだけで、まだどこからも呼ばない。統合はTask 7で行う。

- [ ] **Step 1: 空表示メッセージを変数にする**

`app.js` の `render()` の中（581行目付近）を書き換える。

変更前:
```js
    const msg = ALL.length===0 ? "CSVを読み込むと、ここに保有銘柄が一覧表示されます" : "該当する銘柄はありません";
```

変更後:
```js
    const msg = ALL.length===0 ? listEmptyMsg : "該当する銘柄はありません";
```

- [ ] **Step 2: 状態変数を宣言する**

`app.js` の `let groupMode = "individual";`（9行目）の**直後**に、以下を挿入する。

```js
const LIST_EMPTY_DEFAULT="CSVを読み込むと、ここに保有銘柄が一覧表示されます";
let listEmptyMsg=LIST_EMPTY_DEFAULT;   // 銘柄一覧が空のときに出す文言
let curDate="";                        // いま表示している日付（取得失敗時に選択を戻すため）
let showSeq=0;                         // 古い応答が新しい表示を上書きしないための連番
const HIST_BY_DATE=new Map();          // 日付 → 推移エントリ
```

- [ ] **Step 3: 3つの関数を追加する**

`app.js` の末尾（`hydrateFromDB` の即時実行関数の**直前**）に、以下を挿入する。

```js
// ===== 日付を選んで過去のポートフォリオを表示する =====

// 推移データから日付セレクタを組み立てる（新しい日付が上）
function buildDateSelector(hist){
  const sel=document.getElementById("dateSel");
  if(!sel) return;
  if(!sbEnabled()||!hist||!hist.length){ sel.hidden=true; return; }
  HIST_BY_DATE.clear();
  const opts=['<option value="">—</option>'];
  for(let i=hist.length-1;i>=0;i--){          // 新しい日付を上に出す
    const h=hist[i];
    HIST_BY_DATE.set(h.date,h);
    opts.push(`<option value="${h.date}">${h.date}${h.n?"":"（明細なし）"}</option>`);
  }
  sel.innerHTML=opts.join("");
  sel.hidden=false;
}

// その日の表示を画面に反映する
function applyDateView(date,rows,h){
  listEmptyMsg = rows.length ? LIST_EMPTY_DEFAULT
    : "この日の保有明細は記録されていません。金額は上の資産推移で確認できます";
  loadedNames=[]; LOADED.clear();   // CSV由来の状態は持ち越さない
  setData(rows);                    // RAW もここで入れ替わる
  curDate=date;
  const sel=document.getElementById("dateSel");
  if(sel) sel.value=date;
  const srcEl=document.getElementById("src");
  srcEl.textContent=date.replace(/-/g,"/")+" の記録（Supabase）";
  srcEl.style.color="#dfe3ea";
  histShow(h);                      // 推移カードの詳細バーも同じ日付に合わせる
}

// 指定日の表示に切り替える
async function showDate(date){
  const h=HIST_BY_DATE.get(date);
  if(!h) return;
  const seq=++showSeq;
  if(!h.n){ applyDateView(date,[],h); return; }   // 明細が無い日は取りに行かない
  const rows=await sbLoadHoldings(date);
  if(seq!==showSeq) return;                        // より新しい選択が始まっている
  if(!rows){                                       // 取得失敗 → 表示を壊さず選択を戻す
    const sel=document.getElementById("dateSel");
    if(sel) sel.value=curDate;
    return;
  }
  applyDateView(date,rows,h);
}

document.getElementById("dateSel").addEventListener("change",e=>{
  if(e.target.value) showDate(e.target.value);
});
```

`rows` が空配列で返った場合（`n>0` なのに明細が無いデータ不整合）は `applyDateView(date,[],h)` に落ちるため、案内文が出る。

- [ ] **Step 4: 既存のユニットテストが通ることを確認する**

`http://localhost:8734/test/supabase.test.html?v=t6a` を新しいタブで開く。

期待: `ALL PASS (37)`（`app.js` は読み込まれないので影響しないはずだが、念のため）

- [ ] **Step 5: 画面が壊れていないことを確認する**

新しいタブで `http://localhost:8734/portfolio_app.html?v=t6b` を `force: true` で開く。

期待:
- 表示は従来通り（セレクタはまだ `hidden`）
- コンソールに新しいエラーが出ていない
- `javascript_tool` で `typeof showDate` が `"function"` を返す

- [ ] **Step 6: コミット**

```bash
git add app.js && git commit -m "日付セレクタの構築と表示切り替えの関数を追加"
```

---

### Task 7: 起動時・CSV読込・リセットへ統合する

**Files:**
- Modify: `app.js`（`saveSnapshot`、`rebuildFromLoaded` 末尾、リセット処理、`hydrateFromDB`）

- [ ] **Step 1: saveSnapshot が積む履歴に件数を含める**

`app.js` の `saveSnapshot` の中を書き換える。

変更前:
```js
  hist.push({date:day,total,cost});
```

変更後:
```js
  hist.push({date:day,total,cost,n:RAW.length});   // セレクタの「明細なし」判定に使う
```

- [ ] **Step 2: CSV読込後にセレクタを作り直す**

`app.js` の `rebuildFromLoaded` の中を書き換える。

変更前:
```js
    if(!anyDummy) saveSnapshot(dataDate);   // 資産推移にデータ基準日で記録（デモ時はスキップ）
```

変更後:
```js
    showSeq++;                              // 読み戻し中の表示切り替えを無効化する
    if(!anyDummy){
      saveSnapshot(dataDate);               // 資産推移にデータ基準日で記録（デモ時はスキップ）
      curDate=dataDate||isoLocal();
      buildDateSelector(loadHist());        // 今読み込んだ日付を含めて作り直す
      const sel=document.getElementById("dateSel");
      if(sel) sel.value=curDate;
    }
```

- [ ] **Step 3: リセットでセレクタと文言を戻す**

`app.js` のリセット処理を書き換える。

変更前:
```js
document.getElementById("reset").addEventListener("click",()=>{
  RAW=[]; loadedNames=[]; LOADED.clear();
  setData([]);
  curView="donut";
  document.querySelector(".treemap-btn").textContent="ツリーマップ";
  const srcEl=document.getElementById("src");
  srcEl.textContent="CSV未読み込み";
  srcEl.style.color="";
});
```

変更後:
```js
document.getElementById("reset").addEventListener("click",()=>{
  showSeq++;                        // 取得中の表示切り替えを無効化する
  RAW=[]; loadedNames=[]; LOADED.clear();
  listEmptyMsg=LIST_EMPTY_DEFAULT;
  curDate="";
  setData([]);
  curView="donut";
  document.querySelector(".treemap-btn").textContent="ツリーマップ";
  const sel=document.getElementById("dateSel");
  if(sel) sel.value="";
  const srcEl=document.getElementById("src");
  srcEl.textContent="CSV未読み込み";
  srcEl.style.color="";
});
```

- [ ] **Step 4: 起動時にセレクタを作り最新日を表示する**

`app.js` 末尾の `hydrateFromDB` を書き換える。

変更前:
```js
(async function hydrateFromDB(){
  if(!sbEnabled()) return;          // 未設定時は supabase.js 側で「DB未設定」表示済み
  const rows=await sbLoadHistory();
  if(histLocalWrite) return;        // 取得を待つ間にCSVを読み込んだ → そちらが新しいので上書きしない
  if(!rows||!rows.length) return;   // 取得失敗、またはDBが空 → localStorageの内容を残す
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(rows)); }catch{}
  renderHistory();
})();
```

変更後:
```js
(async function hydrateFromDB(){
  if(!sbEnabled()) return;          // 未設定時は supabase.js 側で「DB未設定」表示済み
  const rows=await sbLoadHistory();
  if(histLocalWrite) return;        // 取得を待つ間にCSVを読み込んだ → そちらが新しいので上書きしない
  if(!rows||!rows.length) return;   // 取得失敗、またはDBが空 → localStorageの内容を残す
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(rows)); }catch{}
  renderHistory();
  buildDateSelector(rows);
  showDate(rows[rows.length-1].date);   // 最新日を表示する
})();
```

- [ ] **Step 5: iframeハーネスで動作を確認する**

**本番DBに触れないよう、必ずこのハーネスを使うこと。** `portfolio_app.html` をそのまま開くと `supabase-config.js` の本番認証情報が読み込まれる。

土台には実設定を読み込まない `test/supabase.test.html` を使う。新しいタブで `http://localhost:8734/test/supabase.test.html?host=1` を `force: true` で開き、`javascript_tool` で以下を実行する。

```js
(async()=>{
  if(window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) return '中止: 土台ページに実設定';
  const bust='t7'+Date.now();
  let html = await (await fetch('/portfolio_app.html',{cache:'no-store'})).text();
  html = html.replace(/(src|href)="((?:sectors|supabase|app|style)[^"]*?)(\?v=[^"]*)?"/g,(m,a,f)=>`${a}="/${f}?${bust}"`);
  html = html.replace(/<script src="[^"]*supabase-config[^"]*"><\/script>/,
    `<script>
       window.SUPABASE_CONFIG={url:"https://fake.supabase.co",key:"k"};
       window.__hits=[];
       window.fetch=async(u,o)=>{
         const url=String(u); window.__hits.push(url);
         if(url.includes('/snapshots?select=')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{snapshot_date:"2026-07-16",total_value:"1000",total_cost:"800",holdings_count:2},
                          {snapshot_date:"2026-08-12",total_value:"1200",total_cost:"800",holdings_count:0},
                          {snapshot_date:"2026-08-13",total_value:"1300",total_cost:"800",holdings_count:1}]};
         if(url.includes('/holdings?snapshot_date=eq.2026-08-13')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{name:"銘柄A",code:"1111",broker:"SBI",acct:"特定",cat:"jp",qty:"10",value:"1300",cost:"800"}]};
         if(url.includes('/holdings?snapshot_date=eq.2026-07-16')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{name:"銘柄B",code:"2222",broker:"楽天",acct:"NISA(成長)",cat:"jp",qty:"5",value:"600",cost:"400"},
                          {name:"銘柄C",code:"3333",broker:"SBI",acct:"特定",cat:"jp",qty:"3",value:"400",cost:"400"}]};
         return {ok:true,status:200,json:async()=>[],text:async()=>"[]"}; };
     </script>`);
  html = html.replace('<head>','<head><base href="/">');
  const saved=localStorage.getItem('kabu_asset_history_v1');
  localStorage.removeItem('kabu_asset_history_v1');
  const old=document.getElementById('t7Frame'); if(old) old.remove();
  const ifr=document.createElement('iframe'); ifr.id='t7Frame';
  ifr.style.cssText='width:1200px;height:900px;border:0'; ifr.srcdoc=html;
  document.body.appendChild(ifr);
  await new Promise(r=>ifr.addEventListener('load',r,{once:true}));
  await new Promise(r=>setTimeout(r,900));
  const w=ifr.contentWindow, d=ifr.contentDocument;
  const sel=d.getElementById('dateSel');
  const 起動時={hidden:sel.hidden, value:sel.value,
    options:[...sel.options].map(o=>o.text),
    件数:d.getElementById('cnt').textContent, src:d.getElementById('src').textContent};

  sel.value='2026-08-12'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  const 明細なし={list:d.getElementById('list').textContent.trim().slice(0,40),
    件数:d.getElementById('cnt').textContent, src:d.getElementById('src').textContent};

  sel.value='2026-07-16'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,400));
  const 過去日={件数:d.getElementById('cnt').textContent,
    donut:d.getElementById('donut').children.length, src:d.getElementById('src').textContent};

  if(saved===null) localStorage.removeItem('kabu_asset_history_v1'); else localStorage.setItem('kabu_asset_history_v1',saved);
  ifr.remove();
  return JSON.stringify({起動時,明細なし,過去日},null,1);
})()
```

期待:
- `起動時.hidden` が `false`、`value` が `"2026-08-13"`
- `起動時.options` が `["—","2026-08-13","2026-08-12（明細なし）","2026-07-16"]`
- `起動時.件数` が `全1銘柄`、`src` が `2026/08/13 の記録（Supabase）`
- `明細なし.list` が `この日の保有明細は記録されていません` で始まる
- `過去日.件数` が `全2銘柄`、`donut` の子要素が0より大きい、`src` が `2026/07/16 の記録（Supabase）`

- [ ] **Step 6: 連打しても最後の選択が勝つことを確認する**

同じ土台ページで、`javascript_tool` により以下を実行する。応答を遅らせたスタブで、古い応答が新しい表示を上書きしないことを見る。

```js
(async()=>{
  if(window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) return '中止: 土台ページに実設定';
  const bust='t7r'+Date.now();
  let html = await (await fetch('/portfolio_app.html',{cache:'no-store'})).text();
  html = html.replace(/(src|href)="((?:sectors|supabase|app|style)[^"]*?)(\?v=[^"]*)?"/g,(m,a,f)=>`${a}="/${f}?${bust}"`);
  html = html.replace(/<script src="[^"]*supabase-config[^"]*"><\/script>/,
    `<script>
       window.SUPABASE_CONFIG={url:"https://fake.supabase.co",key:"k"};
       window.fetch=async(u,o)=>{
         const url=String(u);
         if(url.includes('/snapshots?select=')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{snapshot_date:"2026-07-16",total_value:"1000",total_cost:"800",holdings_count:2},
                          {snapshot_date:"2026-08-13",total_value:"1300",total_cost:"800",holdings_count:1}]};
         if(url.includes('/holdings?snapshot_date=eq.2026-07-16')){
           await new Promise(r=>setTimeout(r,2500));      // 古い方をわざと遅らせる
           return {ok:true,status:200,text:async()=>"[]",
             json:async()=>[{name:"古い銘柄",code:"2222",broker:"楽天",acct:"特定",cat:"jp",qty:"5",value:"600",cost:"400"},
                            {name:"古い銘柄2",code:"3333",broker:"SBI",acct:"特定",cat:"jp",qty:"3",value:"400",cost:"400"}]}; }
         if(url.includes('/holdings?snapshot_date=eq.2026-08-13')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{name:"新しい銘柄",code:"1111",broker:"SBI",acct:"特定",cat:"jp",qty:"10",value:"1300",cost:"800"}]};
         return {ok:true,status:200,json:async()=>[],text:async()=>"[]"}; };
     </script>`);
  html = html.replace('<head>','<head><base href="/">');
  const saved=localStorage.getItem('kabu_asset_history_v1');
  localStorage.removeItem('kabu_asset_history_v1');
  const old=document.getElementById('t7rFrame'); if(old) old.remove();
  const ifr=document.createElement('iframe'); ifr.id='t7rFrame';
  ifr.style.cssText='width:1200px;height:900px;border:0'; ifr.srcdoc=html;
  document.body.appendChild(ifr);
  await new Promise(r=>ifr.addEventListener('load',r,{once:true}));
  await new Promise(r=>setTimeout(r,900));
  const w=ifr.contentWindow, d=ifr.contentDocument;
  const sel=d.getElementById('dateSel');
  sel.value='2026-07-16'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));   // 遅い方
  await new Promise(r=>setTimeout(r,100));
  sel.value='2026-08-13'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));   // 速い方
  await new Promise(r=>setTimeout(r,3200));   // 遅い方が返るのを待つ
  const list=d.getElementById('list').textContent;
  if(saved===null) localStorage.removeItem('kabu_asset_history_v1'); else localStorage.setItem('kabu_asset_history_v1',saved);
  ifr.remove();
  return JSON.stringify({src:d.getElementById('src').textContent,
    新しい銘柄が出ている:list.includes('新しい銘柄'), 古い銘柄が出ている:list.includes('古い銘柄')});
})()
```

期待: `新しい銘柄が出ている: true`、`古い銘柄が出ている: false`、`src` が `2026/08/13 の記録（Supabase）`

- [ ] **Step 7: 明細取得に失敗したとき直前の表示が維持されることを確認する**

新しいタブで土台ページを開き直し、`javascript_tool` で以下を実行する。過去日への切り替えだけを失敗させ、表示が壊れず選択も戻ることを見る。

```js
(async()=>{
  if(window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) return '中止: 土台ページに実設定';
  const bust='t7f'+Date.now();
  let html = await (await fetch('/portfolio_app.html',{cache:'no-store'})).text();
  html = html.replace(/(src|href)="((?:sectors|supabase|app|style)[^"]*?)(\?v=[^"]*)?"/g,(m,a,f)=>`${a}="/${f}?${bust}"`);
  html = html.replace(/<script src="[^"]*supabase-config[^"]*"><\/script>/,
    `<script>
       window.SUPABASE_CONFIG={url:"https://fake.supabase.co",key:"k"};
       window.fetch=async(u,o)=>{
         const url=String(u);
         if(url.includes('/snapshots?select=')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{snapshot_date:"2026-07-16",total_value:"1000",total_cost:"800",holdings_count:2},
                          {snapshot_date:"2026-08-13",total_value:"1300",total_cost:"800",holdings_count:1}]};
         if(url.includes('/holdings?snapshot_date=eq.2026-08-13')) return {ok:true,status:200,text:async()=>"[]",
           json:async()=>[{name:"新しい銘柄",code:"1111",broker:"SBI",acct:"特定",cat:"jp",qty:"10",value:"1300",cost:"800"}]};
         if(url.includes('/holdings?snapshot_date=eq.2026-07-16'))
           return {ok:false,status:500,text:async()=>"boom",json:async()=>[]};   // 過去日だけ失敗させる
         return {ok:true,status:200,json:async()=>[],text:async()=>"[]"}; };
     </script>`);
  html = html.replace('<head>','<head><base href="/">');
  const saved=localStorage.getItem('kabu_asset_history_v1');
  localStorage.removeItem('kabu_asset_history_v1');
  const old=document.getElementById('t7fFrame'); if(old) old.remove();
  const ifr=document.createElement('iframe'); ifr.id='t7fFrame';
  ifr.style.cssText='width:1200px;height:900px;border:0'; ifr.srcdoc=html;
  document.body.appendChild(ifr);
  await new Promise(r=>ifr.addEventListener('load',r,{once:true}));
  await new Promise(r=>setTimeout(r,900));
  const w=ifr.contentWindow, d=ifr.contentDocument;
  const sel=d.getElementById('dateSel');
  const 前={value:sel.value, 件数:d.getElementById('cnt').textContent};
  sel.value='2026-07-16'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,600));
  const 後={value:sel.value, 件数:d.getElementById('cnt').textContent,
            dbStat:d.getElementById('dbStat').textContent,
            list:d.getElementById('list').textContent.includes('新しい銘柄')};
  if(saved===null) localStorage.removeItem('kabu_asset_history_v1'); else localStorage.setItem('kabu_asset_history_v1',saved);
  ifr.remove();
  return JSON.stringify({前,後});
})()
```

期待:
- `前.value` が `2026-08-13`、`前.件数` が `全1銘柄`
- `後.value` が `2026-08-13`（選択が戻っている）
- `後.件数` が `全1銘柄`、`後.list` が `true`（直前の表示が維持されている）
- `後.dbStat` が `DB同期失敗`

- [ ] **Step 8: Supabase未設定でも壊れないことを確認する**

Step 5のハーネスの `window.SUPABASE_CONFIG` の行を `window.SUPABASE_CONFIG={url:"",key:""};` に変えて実行する。

期待: セレクタが `hidden` のまま、`src` が `CSV未読み込み`、コンソールにエラーが出ない

- [ ] **Step 9: ユニットテストが通ることを確認する**

`http://localhost:8734/test/supabase.test.html?v=t7d` を新しいタブで開く。

期待: `ALL PASS (37)`

- [ ] **Step 10: コミット**

```bash
git add app.js && git commit -m "起動時・CSV読込・リセットに日付セレクタを統合する"
```

---

### Task 8: ドキュメントの更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-13-supabase-portfolio-sync-design.md`

- [ ] **Step 1: READMEのDDLに列を足す**

`README.md` のSQLブロックの中を書き換える。

変更前:
```sql
create table snapshots (
  snapshot_date date primary key,
  total_value   numeric not null,
  total_cost    numeric not null,
  updated_at    timestamptz not null default now()
);
```

変更後:
```sql
create table snapshots (
  snapshot_date  date primary key,
  total_value    numeric not null,
  total_cost     numeric not null,
  holdings_count integer not null default 0,
  updated_at     timestamptz not null default now()
);
```

- [ ] **Step 2: READMEの「挙動」の節を更新する**

`README.md` の「### 挙動」の箇条書きを、次の内容にまるごと置き換える。

```markdown
- CSVを読み込むたびに、その日のスナップショット（日付・資産残高・元本）と保有明細の全銘柄が保存されます。同じ日付を読み直すと上書きされます
- 起動時にDBから資産推移を読み戻し、**最新日のポートフォリオを表示します**。CSVを読み込まなくても前回の内容が見られます
- セクション見出しの日付セレクタで、過去の日付のポートフォリオに切り替えられます
- 金額は記録されているが保有明細が無い日は、セレクタに「（明細なし）」と表示されます。Supabaseに接続する前に記録した日や、CSVを残さず取り込んだ日が該当します
- 「履歴クリア」はSupabaseの記録も削除します
```

- [ ] **Step 3: 既存の設計書のスキーマ定義に追記する**

`docs/superpowers/specs/2026-08-13-supabase-portfolio-sync-design.md` の「4. DBスキーマ」のDDLブロック内、`snapshots` の定義を書き換える。

変更前:
```sql
create table snapshots (
  snapshot_date date primary key,
  total_value   numeric not null,
  total_cost    numeric not null,
  updated_at    timestamptz not null default now()
);
```

変更後:
```sql
create table snapshots (
  snapshot_date  date primary key,
  total_value    numeric not null,
  total_cost     numeric not null,
  holdings_count integer not null default 0,   -- 2026-08-13 追加。過去日ポートフォリオ表示で使う
  updated_at     timestamptz not null default now()
);
```

- [ ] **Step 4: 表示を確認する**

`README.md` を読み返し、コードフェンスの開始と終了が対になっていること、表が崩れていないことを目視で確認する。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/superpowers/specs/2026-08-13-supabase-portfolio-sync-design.md && git commit -m "ドキュメントに holdings_count と日付セレクタを反映"
```

---

### Task 9: 実データでの確認（ユーザー作業）

エージェントが実行する場合はここで停止し、ユーザーに引き渡すこと。本番の認証情報を使うため、エージェントは操作しない。

- [ ] **Step 1: ページを開いて起動時の表示を確認する**

`portfolio_app.html` をハードリロード（Ctrl+Shift+R）で開く。

期待:
- 日付セレクタに `2026-08-13` が選ばれている
- ドーナツと銘柄一覧に41銘柄分が表示されている
- アプリバーに `2026/08/13 の記録（Supabase）`
- ステータスが `DB同期済`

- [ ] **Step 2: 過去日に切り替える**

セレクタで `2026-06-28` を選ぶ。

期待: 39銘柄が表示され、資産推移カードの詳細バーも `2026/06/28` に変わる

- [ ] **Step 3: 明細なしの日を確認する**

セレクタで `2026-08-12（明細なし）` を選ぶ。

期待: 銘柄一覧の位置に「この日の保有明細は記録されていません。金額は上の資産推移で確認できます」と出る

- [ ] **Step 4: セレクタの表記が実態と合っているか確認する**

セレクタを開き、`（明細なし）` が付いているのが `2026-08-03` / `2026-08-07` / `2026-08-12` の3日だけであることを確認する。

- [ ] **Step 5: CSV読込が従来通り動くか確認する**

最新のCSVを読み込む。

期待: その内容が表示され、セレクタがその日付に移動し、`snapshots.holdings_count` が銘柄数と一致する

- [ ] **Step 6: ブランチを仕上げる**

すべて確認できたら、superpowers:finishing-a-development-branch スキルでマージ方法を決める。

---

## 完了の定義

- `test/supabase.test.html` が `ALL PASS (37)` を表示する
- Supabase未設定でセレクタが出ず、アプリが従来通り動作する
- 起動時に最新日のポートフォリオが表示される
- 日付を切り替えるとドーナツ・銘柄一覧・推移カードの詳細バーが揃って変わる
- 連続で切り替えても最後に選んだ日付の内容が表示される
- 明細が無い日で案内文が出る
