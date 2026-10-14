# 資産全体表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月次資産Excel（「〇〇〇〇年度　資産」シート）をページで読み込み、CSVで足りない分をExcelで補った「資産全体」とその月次推移を表示する。

**Architecture:** Excelの読み取りと合算は、DOMにもネットワークにも触らない純粋関数として新ファイル `assets.js` に置く。`supabase.js` には新テーブル `monthly_assets` の保存・読み込みと、保有明細の一括取得を足す。`app.js` は「資産Excel」ボタン、資産全体セクションの描画、起動時の読み戻しを受け持つ。合算は保存時ではなく表示のたびに行う。

**Tech Stack:** 素のHTML/CSS/JavaScript（ビルドなし）、SheetJS 0.20.3（CDN）、Supabase PostgREST（素の `fetch`）、Cloudflare Workers（公開版の中継）

**Spec:** `docs/superpowers/specs/2026-10-14-total-assets-design.md`

**Branch:** `feat-total-assets`（作成済み。設計書はコミット済み）

## Global Constraints

- ビルド不要のまま動くこと。`portfolio_app.html` をローカルHTTPサーバーで開いて動作する
- `supabase.js` の公開関数は例外を投げない（失敗は `null` / `false` で返す）
- 対象シート名は `/^(\d{4})年度\s*資産\s*$/`
- 同じ記録日が複数シートにあれば、新しい年度のシートの値だけを使う
- CSVの組み合わせ範囲は「前の記録日より後〜その記録日（含む）」。最初の記録日は「31日前より後〜その記録日」
- 楽天CSVの外貨預り金は差し引かない。差し引くのはSBIの預金からSBI CSVの外貨預り金だけ
- 表示カテゴリは `securities`（証券）/ `pension`（企業DC・持株）/ `deposit`（預金）/ `crypto`（仮想通貨）/ `cash`（現金・電子マネー）/ `other`（その他）
- localStorage のキーは `kabu_monthly_assets_v1`
- `git push` と PR 作成はしない（ユーザーの指示があるまでローカルコミットまで）
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける

## Review Focus

1. **PostgRESTの行数上限** — Supabaseは1回の応答を既定で1000行に制限する。`monthly_assets` は全年度で約1,100行あり、`holdings` も日数×銘柄数で1000行を超える。黙って切り捨てると古い月が欠ける → Task 3 のページ送りテストで固定
2. **SheetJSの日付のずれ** — タイムゾーンの影響で `Date` が前日 23:59:39 になることがある。記録日が1日ずれるとCSVとの組み合わせが狂う → Task 1 の `workbookToSheets` テストと Task 5 の実ファイル確認で固定
3. **証券会社が記録されていない古い保有明細** — `broker` が空の行は、どの証券会社のCSVか分からない。合算に混ぜると二重計上になる → Task 2 の `summarizeHoldings` テストで固定
4. **SBIのCSVはあるがExcelにSBI預金の行がない月** — 外貨預り金を引く相手がいないのに引くと、預金が減りすぎる → Task 2 のテストで固定
5. **DBが空でも手元のキャッシュは残す** — Excelを読み込んだ直後にSupabaseへの保存が失敗した場合、次回起動時にDBの空配列で手元の表示を消してはいけない → Task 4 のハーネス確認で固定

---

## テストの実行方法

ユニットテストは相対パスで `../assets.js` / `../supabase.js` を読むため、`file://` では動かない。ローカルHTTPサーバー経由で開く。

```
preview_start { name: "portfolio-local" }        # C:\work\02_programs\12_kabu をポート8734で配信
tabs_create
navigate      { url: "http://localhost:8734/test/assets.test.html", tabId: "<new>", force: true }
get_page_text { tabId: "<new>" }
```

期待する結果は、ページ先頭に `ALL PASS (件数)` と出ること。`FAILED` なら、その下の `FAIL` 行に失敗したテスト名と理由が出る。

テストページは `document.write` で毎回別URLとしてスクリプトを読むので、編集内容がそのまま反映される。

**`portfolio_app.html` は本番DBにつながっている。** `supabase-config.js` に本番の認証情報が入っているため、画面の確認は必ず Task 4 のiframeハーネス（偽のエンドポイントに差し替える）で行うこと。

## 設計書からの変更

1. **`sbLoadBrokerTotals()` を2つに分ける** — 設計書4.3では `supabase.js` で集計まで行うとしていた。CSVを読み込んだ直後にも同じ集計が必要になる（DBを経由せずに手元の明細から計算する）ため、集計は純粋関数 `summarizeHoldings()` として `assets.js` に置き、`supabase.js` は生の行を返す `sbLoadAllHoldings()` にする。Task 3 で設計書も直す
2. **履歴の期間ボタンにidを付ける** — 既存コード `document.querySelectorAll(".hseg button")` は、ページ内のすべての `.hseg` を推移グラフの期間ボタンとして扱う。資産全体の期間ボタンに同じクラスを使えるよう、既存側を `#histSeg button` に絞る

## ファイル構成

| ファイル | 扱い | 変更内容 |
|---|---|---|
| `assets.js` | 新規 | `workbookToSheets` / `parseAssetSheets` / `summarizeHoldings` / `combineMonthly` / `ASSET_CATS` |
| `test/assets.test.html` | 新規 | `assets.js` の単体テスト |
| `supabase.js` | 変更 | `sbSaveMonthlyAssets` / `sbLoadMonthlyAssets` / `sbLoadAllHoldings` を追加（公開7関数 → 10関数） |
| `test/supabase.test.html` | 変更 | 7件追加（39件 → 46件） |
| `worker/worker.js` | 変更 | 中継許可に `monthly_assets` を追加 |
| `worker/build.mjs` | 変更 | 公開ファイルに `assets.js` を追加 |
| `portfolio_app.html` | 変更 | 資産Excelボタン、資産全体セクション、スクリプト読み込み |
| `style.css` | 変更 | 資産全体セクションのスタイル |
| `app.js` | 変更 | 資産全体の描画・読み込み・読み戻し、既存処理へのフック |
| `README.md` | 変更 | 機能説明とテーブル作成SQL |
| `docs/superpowers/specs/2026-10-14-total-assets-design.md` | 変更 | 4.3 を `sbLoadAllHoldings` + `summarizeHoldings` に更新 |

---

### Task 1: Excelの読み取り（`assets.js` の前半）

**Files:**
- Create: `assets.js`
- Create: `test/assets.test.html`

**Interfaces:**
- Consumes: なし
- Produces:
  - `window.workbookToSheets(wb) → Array<{name:string, rows:Array<Array<any>>}>`。`wb` はSheetJSのワークブック。セルの `Date` は `"YYYY-MM-DD"` 文字列に変換済み
  - `window.parseAssetSheets(sheets) → {rows:Array<{date:string, kind:string, item:string, amount:number}>, years:number, months:number}`。`rows` は記録日の昇順

- [ ] **Step 1: テストページを作る（失敗するテスト）**

`test/assets.test.html` を次の内容で作る。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>assets.js テスト</title>
<style>
  body{background:#12151c;color:#e8ebf2;font-family:monospace;padding:24px;line-height:1.7;}
  .ok{color:#6fcf97;} .ng{color:#ff8a8a;}
  h1{font-size:16px;} #sum{font-size:15px;font-weight:700;margin-bottom:12px;}
</style>
</head>
<body>
<h1>assets.js テスト</h1>
<div id="sum">実行中…</div>
<pre id="out"></pre>

<!-- ブラウザが古い assets.js を握り続けないよう、毎回別URLとして読ませる -->
<script>document.write('<scr'+'ipt src="../assets.js?cb='+Date.now()+'"><\/scr'+'ipt>');</script>
<script>
// ---- 最小のテストハーネス ----
const TESTS=[];
function test(name, fn){ TESTS.push({name, fn}); }
function assert(cond, msg){ if(!cond) throw new Error(msg||"assertion failed"); }
function eq(actual, expected, msg){
  const a=JSON.stringify(actual), b=JSON.stringify(expected);
  if(a!==b) throw new Error((msg?msg+": ":"")+"expected "+b+" but got "+a);
}

// === tests ===

// 2026年度型：A列が空で、B列が種類・C列が資産
const S2026={name:"2026年度　資産", rows:[
  [null,null,null,null,null,null],
  [null,null,"メモ",null,null,null],
  [null,null,null,"2026-03-29","2026-04-28",null],
  [null,"種類","資産","３月","４月","合計（実際）"],
  [null,"株式","楽天証券",100,110,999],
  [null,null,"SBI証券",200,210,null],
  [null,null,"持株",null,50,null],
  [null,"口座預金","SBI証券",300,0,null],
  [null,"電子マネー","Amazon ",7,"",null],
  [null,"合計","合計",607,370,null],
  [null,null,"今月-先月",0,-237,null],
]};

test("parseAssetSheets: 種類の引き継ぎ・空欄と文字列の除外・0は残す・日付のない列は読まない", ()=>{
  const r=parseAssetSheets([S2026]);
  eq(r.rows,[
    {date:"2026-03-29",kind:"株式",item:"楽天証券",amount:100},
    {date:"2026-03-29",kind:"株式",item:"SBI証券",amount:200},
    {date:"2026-03-29",kind:"口座預金",item:"SBI証券",amount:300},
    {date:"2026-03-29",kind:"電子マネー",item:"Amazon",amount:7},
    {date:"2026-04-28",kind:"株式",item:"楽天証券",amount:110},
    {date:"2026-04-28",kind:"株式",item:"SBI証券",amount:210},
    {date:"2026-04-28",kind:"株式",item:"持株",amount:50},
    {date:"2026-04-28",kind:"口座預金",item:"SBI証券",amount:0},
  ]);
  eq(r.years,1); eq(r.months,2);
});

test("parseAssetSheets: 列が1つずれた2022年度型と、合計行の下の表を読まない", ()=>{
  const s={name:"2022年度　資産", rows:[
    [null,null,"目標",null,null],
    ["実際",null,null,"2022-04-02","2022-05-01"],
    [null,"種類","資産","現在","５月"],
    [null,"株式","株式（楽天）",1000,1100],
    [null,"証券口座","SBI証券口座",500,500],
    [null,"合計","合計",1500,1600],
    ["理想",null,"資産","現在","５月"],
    [null,null,"金融資産",9999,9999],
  ]};
  eq(parseAssetSheets([s]).rows,[
    {date:"2022-04-02",kind:"株式",item:"株式（楽天）",amount:1000},
    {date:"2022-04-02",kind:"証券口座",item:"SBI証券口座",amount:500},
    {date:"2022-05-01",kind:"株式",item:"株式（楽天）",amount:1100},
    {date:"2022-05-01",kind:"証券口座",item:"SBI証券口座",amount:500},
  ]);
});

test("parseAssetSheets: 年度シート以外は読まず、末尾に空白のあるシート名は読む", ()=>{
  const body=[[null,null,"2023-04-01"],["種類","資産","現在"],["現金","現ナマ",10],["合計","合計",10]];
  const r=parseAssetSheets([
    {name:"Sheet1", rows:body},
    {name:"収支", rows:body},
    {name:"2023年度　資産 ", rows:body},
  ]);
  eq(r.rows,[{date:"2023-04-01",kind:"現金",item:"現ナマ",amount:10}]);
  eq(r.years,1);
});

test("parseAssetSheets: 重なる記録日は新しい年度のシートを使う（シートの並び順によらない）", ()=>{
  const s2025={name:"2025年度　資産", rows:[
    [null,null,"2025-03-28","2026-03-29"],
    ["種類","資産","３月","３月"],
    ["現金","現ナマ",1,2],
    ["合計","合計",1,2],
  ]};
  const s2026={name:"2026年度　資産", rows:[
    [null,null,"2026-03-29","2026-04-28"],
    ["種類","資産","３月","４月"],
    ["現金","現ナマ",3,4],
    ["仮想通貨","日本円",5,5],
    ["合計","合計",8,9],
  ]};
  const r=parseAssetSheets([s2025,s2026]);
  eq(r.rows,[
    {date:"2025-03-28",kind:"現金",item:"現ナマ",amount:1},
    {date:"2026-03-29",kind:"現金",item:"現ナマ",amount:3},
    {date:"2026-03-29",kind:"仮想通貨",item:"日本円",amount:5},
    {date:"2026-04-28",kind:"現金",item:"現ナマ",amount:4},
    {date:"2026-04-28",kind:"仮想通貨",item:"日本円",amount:5},
  ]);
  eq(r.years,2); eq(r.months,3);
});

test("parseAssetSheets: 同じ種類・項目が2行あれば合算する", ()=>{
  const s={name:"2024年度　資産", rows:[
    [null,null,"2024-04-28"],
    ["種類","資産","４月"],
    ["現金","財布",10],
    [null,"財布",5],
    ["合計","合計",15],
  ]};
  eq(parseAssetSheets([s]).rows,[{date:"2024-04-28",kind:"現金",item:"財布",amount:15}]);
});

test("parseAssetSheets: 対象シートがない・見出しがないときは空", ()=>{
  eq(parseAssetSheets([{name:"Sheet1",rows:[]}]),{rows:[],years:0,months:0});
  eq(parseAssetSheets([{name:"2026年度　資産",rows:[["a","b"],[1,2]]}]),{rows:[],years:0,months:0});
  eq(parseAssetSheets([]),{rows:[],years:0,months:0});
});

test("workbookToSheets: Dateを日付文字列にし、前日23:59台にずれた値も当日に丸める", ()=>{
  const old=window.XLSX;
  let opt=null;
  window.XLSX={utils:{sheet_to_json:(ws,o)=>{ opt=o; return ws.data; }}};
  try{
    const wb={SheetNames:["A"], Sheets:{A:{data:[
      [new Date(2026,8,28,23,59,39), new Date(2026,2,29), 5, "x", null]
    ]}}};
    eq(workbookToSheets(wb),[{name:"A",rows:[["2026-09-29","2026-03-29",5,"x",null]]}]);
    eq(opt.header,1); eq(opt.raw,true); eq(opt.defval,null); eq(opt.blankrows,true);
  }finally{ window.XLSX=old; }
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
  document.title = (fail===0?"ALL PASS":"FAILED")+" - assets.js テスト";
})();
</script>
</body>
</html>
```

- [ ] **Step 2: テストが失敗することを確認する**

「テストの実行方法」に従い `http://localhost:8734/test/assets.test.html` を開く。
期待: `7 FAILED`（`parseAssetSheets is not defined` / `workbookToSheets is not defined`）

- [ ] **Step 3: `assets.js` を作る**

```js
// 月次資産Excelの読み取りと、CSVとの合算。DOMにもネットワークにも触らない純粋関数だけを置く。
// app.jsから使う入口は workbookToSheets / parseAssetSheets / summarizeHoldings / combineMonthly / ASSET_CATS。
(function(){

  const SHEET_RE=/^(\d{4})年度\s*資産\s*$/;
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

  const str=v=>v==null?"":String(v).trim();
  const pad2=n=>String(n).padStart(2,"0");

  // SheetJSのDateをYYYY-MM-DDにする。
  // タイムゾーンの影響で前日23:59台になることがあるため、半日足してから日付を取り出す
  function ymd(d){
    const t=new Date(d.getTime()+12*3600*1000);
    return t.getFullYear()+"-"+pad2(t.getMonth()+1)+"-"+pad2(t.getDate());
  }

  // SheetJSのワークブックを、シートごとの2次元配列にする
  function workbookToSheets(wb){
    return wb.SheetNames.map(name=>({
      name,
      rows:window.XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null,blankrows:true})
        .map(r=>r.map(v=>v instanceof Date?ymd(v):v))
    }));
  }

  // 「種類」「資産」が隣り合うセルを見出しとする（年度によって列位置が違うため固定しない）
  function findHeader(rows){
    for(let r=0;r<rows.length;r++){
      const row=rows[r]||[];
      for(let c=0;c<row.length-1;c++)
        if(str(row[c])==="種類" && str(row[c+1])==="資産") return {r,c};
    }
    return null;
  }

  function parseAssetSheets(sheets){
    const list=[];
    for(const s of sheets||[]){
      const m=String(s.name).match(SHEET_RE);
      if(m) list.push({fy:+m[1], rows:s.rows||[]});
    }
    list.sort((a,b)=>b.fy-a.fy);          // 新しい年度から読み、重なる記録日は先に読んだ方を使う
    const claimed=new Set(), sum=new Map();
    let years=0;
    for(const sh of list){
      const h=findHeader(sh.rows);
      if(!h || h.r===0) continue;
      const dateRow=sh.rows[h.r-1]||[];
      const cols=[];
      for(let j=h.c+2;j<dateRow.length;j++){
        const d=dateRow[j];
        if(typeof d==="string" && DATE_RE.test(d) && !claimed.has(d)) cols.push({j,d});
      }
      if(!cols.length) continue;
      cols.forEach(x=>claimed.add(x.d));
      years++;
      let kind="";
      for(let i=h.r+1;i<sh.rows.length;i++){
        const row=sh.rows[i]||[];
        const k=str(row[h.c]);
        if(k==="合計") break;               // 「今月-先月」や「理想」の表は読まない
        if(k) kind=k;
        const item=str(row[h.c+1]);
        if(!kind||!item) continue;
        for(const {j,d} of cols){
          const v=row[j];
          if(typeof v!=="number"||!isFinite(v)) continue;
          const key=d+"\t"+kind+"\t"+item;
          sum.set(key,(sum.get(key)||0)+v);
        }
      }
    }
    const rows=[...sum].map(([key,amount])=>{
      const [date,kind,item]=key.split("\t");
      return {date,kind,item,amount};
    }).sort((a,b)=>a.date.localeCompare(b.date));
    return {rows, years:rows.length?years:0, months:new Set(rows.map(r=>r.date)).size};
  }

  window.workbookToSheets=workbookToSheets;
  window.parseAssetSheets=parseAssetSheets;

})();
```

- [ ] **Step 4: テストが通ることを確認する**

テストページを再読み込みする。
期待: `ALL PASS (7)`

- [ ] **Step 5: コミット**

```bash
git add assets.js test/assets.test.html
git commit -m "資産Excelのシートを読み取る処理を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CSVとの合算（`assets.js` の後半）

**Files:**
- Modify: `assets.js`（`window.workbookToSheets=...` の直前に追記、末尾の公開に3行追加）
- Modify: `test/assets.test.html`（`// === /tests ===` の直前に追記）

**Interfaces:**
- Consumes: Task 1 の `parseAssetSheets` が返す `rows` の形 `{date, kind, item, amount}`
- Produces:
  - `window.ASSET_CATS: Array<{key:string, label:string, color:string}>`。積み上げの下から順に `securities, pension, deposit, crypto, cash, other`
  - `window.summarizeHoldings(rows) → Array<{date:string, broker:string, total:number, usdCash:number}>`。入力は `{date, broker, code, value}` の配列。`broker` が空の行は無視。`code==="現金"` の行を外貨預り金として `usdCash` に足す
  - `window.combineMonthly(excelRows, brokerTotals) → Array<{date:string, total:number, cats:{securities,pension,deposit,crypto,cash,other:number}, csvDate:string|null}>`。記録日の昇順。`brokerTotals` は `summarizeHoldings` の戻り値の形

- [ ] **Step 1: 失敗するテストを追加する**

`test/assets.test.html` の `// === /tests ===` の直前に追記する。

```js
// ---- 合算 ----
// 1か月分のExcel行（CSVを使わなければ 証券3150 / 企業DC・持株400 / 預金1000 / 仮想通貨50 / 現金25 = 4625）
const BASE=[
  {kind:"株式",item:"楽天証券",amount:1000},
  {kind:"株式",item:"SBI証券",amount:2000},
  {kind:"株式",item:"企業DC",amount:300},
  {kind:"株式",item:"持株",amount:100},
  {kind:"債権",item:"SBI証券",amount:150},
  {kind:"仮想通貨",item:"BTC",amount:50},
  {kind:"口座預金",item:"SBI証券",amount:400},
  {kind:"口座預金",item:"楽天銀行",amount:600},
  {kind:"現金",item:"現ナマ",amount:20},
  {kind:"電子マネー",item:"PayPay",amount:5},
];
const mk=(date,base)=>(base||BASE).map(r=>Object.assign({date},r));
const EX=[...mk("2026-08-26"),...mk("2026-09-29")];
const EXCEL_ONLY={securities:3150,pension:400,deposit:1000,crypto:50,cash:25,other:0};

test("combineMonthly: CSVがなければExcelの値をカテゴリ別にまとめる", ()=>{
  eq(combineMonthly(EX,[]),[
    {date:"2026-08-26",total:4625,cats:EXCEL_ONLY,csvDate:null},
    {date:"2026-09-29",total:4625,cats:EXCEL_ONLY,csvDate:null},
  ]);
});

test("combineMonthly: SBIのCSVがあればSBIの株式・債権を置き換え、SBI預金から外貨預り金を引く", ()=>{
  const r=combineMonthly(EX,[{date:"2026-09-15",broker:"SBI",total:2600,usdCash:120}]);
  eq(r[0].csvDate,null,"8月は範囲外");
  eq(r[1],{date:"2026-09-29",total:4955,
    cats:{securities:3600,pension:400,deposit:880,crypto:50,cash:25,other:0},csvDate:"2026-09-15"});
});

test("combineMonthly: 楽天のCSVだけなら楽天の株式だけを置き換え、預金は引かない", ()=>{
  const r=combineMonthly(EX,[{date:"2026-09-15",broker:"楽天",total:1500,usdCash:30}]);
  eq(r[1].cats,{securities:3650,pension:400,deposit:1000,crypto:50,cash:25,other:0});
  eq(r[1].total,5125);
});

test("combineMonthly: 楽天とSBIが同じ日にあれば両方置き換える", ()=>{
  const r=combineMonthly(EX,[
    {date:"2026-09-15",broker:"楽天",total:1500,usdCash:0},
    {date:"2026-09-15",broker:"SBI",total:2600,usdCash:120},
  ]);
  eq(r[1].cats.securities,4100);
  eq(r[1].cats.deposit,880);
});

test("combineMonthly: 前の記録日以前のCSVは使わない（最初の月は31日前より後だけ）", ()=>{
  const r=combineMonthly(EX,[
    {date:"2026-07-01",broker:"SBI",total:9999,usdCash:0},   // 8/26の31日前(7/26)より前 → 使わない
    {date:"2026-08-20",broker:"SBI",total:2600,usdCash:0},   // 8月分に使う。9月分には使わない
  ]);
  eq(r[0].csvDate,"2026-08-20");
  eq(r[0].cats.securities,3600);
  eq(r[1].csvDate,null);
  eq(r[1].cats.securities,3150);
});

test("combineMonthly: 記録日当日のCSVは使い、翌日のCSVは使わない", ()=>{
  eq(combineMonthly(EX,[{date:"2026-09-29",broker:"SBI",total:2600,usdCash:0}])[1].csvDate,"2026-09-29");
  eq(combineMonthly(EX,[{date:"2026-09-30",broker:"SBI",total:2600,usdCash:0}])[1].csvDate,null);
});

test("combineMonthly: 範囲内に複数のCSVがあれば最も新しい日を使う", ()=>{
  const r=combineMonthly(EX,[
    {date:"2026-09-10",broker:"SBI",total:2500,usdCash:0},
    {date:"2026-09-20",broker:"SBI",total:2700,usdCash:0},
  ]);
  eq(r[1].csvDate,"2026-09-20");
  eq(r[1].cats.securities,3700);
});

test("combineMonthly: ExcelにSBI預金の行がなければ外貨預り金を引かない", ()=>{
  const base=BASE.filter(r=>!(r.kind==="口座預金"&&r.item==="SBI証券"));
  const r=combineMonthly(mk("2026-09-29",base),[{date:"2026-09-15",broker:"SBI",total:2600,usdCash:120}]);
  eq(r[0].cats.deposit,600);
});

test("combineMonthly: SBIの株式が複数行あっても置き換えは1回だけ", ()=>{
  const base=[
    {kind:"株式",item:"SBI証券(日本株・NISA)",amount:700},
    {kind:"株式",item:"SBI証券(米国株)",amount:500},
    {kind:"株式",item:"企業DC",amount:300},
  ];
  const r=combineMonthly(mk("2024-03-27",base),[{date:"2024-03-20",broker:"SBI",total:1300,usdCash:0}]);
  eq(r[0].cats.securities,1300);
  eq(r[0].cats.pension,300);
});

test("combineMonthly: 過去年度の種類名と、知らない種類の分類", ()=>{
  const base=[
    {kind:"株式",item:"株式（楽天）",amount:1},
    {kind:"株式",item:"株式（SBI）",amount:2},
    {kind:"証券口座",item:"楽天証券口座",amount:4},
    {kind:"銀行貯金",item:"SMBC",amount:8},
    {kind:"口座",item:"SBI証券",amount:16},
    {kind:"電子マネー",item:"楽天cash",amount:32},
    {kind:"不動産",item:"土地",amount:64},
  ];
  eq(combineMonthly(mk("2022-04-02",base),[])[0].cats,
    {securities:3,pension:0,deposit:28,crypto:0,cash:32,other:64});
});

test("combineMonthly: 知らない証券会社しかない日はCSVなし扱い", ()=>{
  eq(combineMonthly(EX,[{date:"2026-09-15",broker:"その他",total:5,usdCash:0}])[1].csvDate,null);
});

test("combineMonthly: Excelが空なら空配列", ()=>{
  eq(combineMonthly([],[{date:"2026-09-15",broker:"SBI",total:5,usdCash:0}]),[]);
});

test("summarizeHoldings: 日付・証券会社ごとに合計し、外貨預り金を分けて数える", ()=>{
  eq(summarizeHoldings([
    {date:"2026-09-15",broker:"SBI",code:"7203",value:100},
    {date:"2026-09-15",broker:"SBI",code:"現金",value:30},
    {date:"2026-09-15",broker:"楽天",code:"投信",value:50},
    {date:"2026-09-01",broker:"SBI",code:"AAPL",value:70},
  ]),[
    {date:"2026-09-01",broker:"SBI",total:70,usdCash:0},
    {date:"2026-09-15",broker:"SBI",total:130,usdCash:30},
    {date:"2026-09-15",broker:"楽天",total:50,usdCash:0},
  ]);
});

test("summarizeHoldings: 証券会社が記録されていない行と、数値でない金額は無視する", ()=>{
  eq(summarizeHoldings([
    {date:"2026-07-01",broker:"",code:"7203",value:100},
    {date:"2026-07-01",broker:null,code:"7203",value:100},
    {date:"2026-07-01",broker:"SBI",code:"7203",value:"abc"},
    {date:"2026-07-01",broker:"SBI",code:"7203",value:"40"},
  ]),[{date:"2026-07-01",broker:"SBI",total:40,usdCash:0}]);
  eq(summarizeHoldings(null),[]);
});

test("ASSET_CATS: 積み上げの下から証券・企業DC・預金・仮想通貨・現金・その他", ()=>{
  eq(ASSET_CATS.map(c=>c.key),["securities","pension","deposit","crypto","cash","other"]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

テストページを再読み込みする。
期待: `15 FAILED / 7 passed`（`combineMonthly is not defined` など）

- [ ] **Step 3: `assets.js` に合算処理を追加する**

`assets.js` の `window.workbookToSheets=workbookToSheets;` の直前に追記する。

```js
  // 表示カテゴリ（積み上げの下から順）
  const ASSET_CATS=[
    {key:"securities", label:"証券",             color:"#e3c477"},
    {key:"pension",    label:"企業DC・持株",     color:"#3ddc97"},
    {key:"deposit",    label:"預金",             color:"#5bc6d8"},
    {key:"crypto",     label:"仮想通貨",         color:"#a98bff"},
    {key:"cash",       label:"現金・電子マネー", color:"#ff9f6b"},
    {key:"other",      label:"その他",           color:"#7e8496"},
  ];
  const BOND_KINDS=new Set(["債権","債券"]);
  const DEPOSIT_KINDS=new Set(["口座預金","口座","証券口座","銀行貯金"]);
  const CASH_KINDS=new Set(["現金","電子マネー"]);

  // Excelの行を、CSVで置き換えるかどうかの区分に分ける
  function classify(kind,item){
    if(kind==="株式"){
      if(item.includes("楽天")) return "rakuten";
      if(item.includes("SBI")) return "sbi_sec";
      return "pension";
    }
    if(BOND_KINDS.has(kind)) return item.includes("SBI")?"sbi_sec":"other";
    if(DEPOSIT_KINDS.has(kind)) return item.includes("SBI")?"sbi_dep":"deposit";
    if(kind==="仮想通貨") return "crypto";
    if(CASH_KINDS.has(kind)) return "cash";
    return "other";
  }
  const CLASS_CAT={rakuten:"securities",sbi_sec:"securities",sbi_dep:"deposit",
    pension:"pension",deposit:"deposit",crypto:"crypto",cash:"cash",other:"other"};

  // 保有明細を日付・証券会社ごとに合計する。外貨預り金（code "現金"）は別にも数える
  function summarizeHoldings(rows){
    const m=new Map();
    for(const r of rows||[]){
      if(!r||!r.date||!r.broker) continue;   // 証券会社を記録する前の明細は、どのCSVか分からないので使わない
      const v=Number(r.value);
      if(!isFinite(v)) continue;
      const key=r.date+"\t"+r.broker;
      const e=m.get(key)||{date:r.date,broker:r.broker,total:0,usdCash:0};
      e.total+=v;
      if(r.code==="現金") e.usdCash+=v;
      m.set(key,e);
    }
    return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }

  function daysBefore(date,n){
    const [y,m,d]=date.split("-").map(Number);
    const t=new Date(Date.UTC(y,m-1,d-n));
    return t.getUTCFullYear()+"-"+pad2(t.getUTCMonth()+1)+"-"+pad2(t.getUTCDate());
  }

  // Excelの記録日ごとに、その月の範囲で最新のCSVと組み合わせて資産全体を出す
  function combineMonthly(excelRows,brokerTotals){
    const byDate=new Map();
    for(const r of excelRows||[]){
      if(!byDate.has(r.date)) byDate.set(r.date,[]);
      byDate.get(r.date).push(r);
    }
    const dates=[...byDate.keys()].sort();
    const bts=brokerTotals||[];
    return dates.map((date,i)=>{
      // 前の記録日より後〜この記録日まで（最初の月は31日前より後）。古いCSVでExcelの新しい値を上書きしないため
      const lo=i>0?dates[i-1]:daysBefore(date,31);
      let csvDate=null;
      for(const b of bts) if(b.date>lo && b.date<=date && (!csvDate||b.date>csvDate)) csvDate=b.date;
      const bk={};
      if(csvDate) for(const b of bts) if(b.date===csvDate) bk[b.broker]=b;
      const rk=bk["楽天"], sbi=bk["SBI"];
      const cats={};
      ASSET_CATS.forEach(c=>cats[c.key]=0);
      let hasSbiDep=false;
      for(const r of byDate.get(date)){
        const cls=classify(r.kind,r.item);
        if(cls==="rakuten"&&rk) continue;
        if(cls==="sbi_sec"&&sbi) continue;
        if(cls==="sbi_dep") hasSbiDep=true;
        cats[CLASS_CAT[cls]]+=r.amount;
      }
      if(rk) cats.securities+=rk.total;
      if(sbi){
        cats.securities+=sbi.total;
        // SBIの外貨預り金はCSVにも入っているので、Excelの預金から引いて二重計上を防ぐ（負になっても0にしない）
        if(hasSbiDep) cats.deposit-=sbi.usdCash;
      }
      const total=ASSET_CATS.reduce((s,c)=>s+cats[c.key],0);
      return {date,total,cats,csvDate:(rk||sbi)?csvDate:null};
    });
  }
```

末尾の公開部分を次のようにする。

```js
  window.workbookToSheets=workbookToSheets;
  window.parseAssetSheets=parseAssetSheets;
  window.summarizeHoldings=summarizeHoldings;
  window.combineMonthly=combineMonthly;
  window.ASSET_CATS=ASSET_CATS;
```

- [ ] **Step 4: テストが通ることを確認する**

テストページを再読み込みする。
期待: `ALL PASS (22)`

- [ ] **Step 5: コミット**

```bash
git add assets.js test/assets.test.html
git commit -m "資産ExcelとCSVを月ごとに合算する処理を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Supabaseへの保存・読み込みと中継許可

**Files:**
- Modify: `supabase.js`（`sbDeleteAll` の後ろに追記、公開部分に3行追加、2行目のコメント更新）
- Modify: `test/supabase.test.html`（`// === /tests ===` の直前に追記）
- Modify: `worker/worker.js:7`
- Modify: `docs/superpowers/specs/2026-10-14-total-assets-design.md`（4.3）

**Interfaces:**
- Consumes: 既存の `sbFetch(path, options)` / `sbEnabled()` / `sbStatus(state)`
- Produces:
  - `window.sbSaveMonthlyAssets(rows) → Promise<boolean>`。`rows` は `{date, kind, item, amount}` の配列。全行DELETE → 500行ずつINSERT
  - `window.sbLoadMonthlyAssets() → Promise<Array<{date, kind, item, amount:number}>|null>`
  - `window.sbLoadAllHoldings() → Promise<Array<{date, broker:string, code:string, value:number}>|null>`。`broker` / `code` の欠損は `""`

- [ ] **Step 1: 失敗するテストを追加する**

`test/supabase.test.html` の `// === /tests ===` の直前に追記する。

```js
// ---- 月次資産・保有明細の一括取得 ----
const rowsOf=(n,f)=>Array.from({length:n},(_,i)=>f(i));

test("sbLoadMonthlyAssets: 空のページが返るまで続けて読み、形を変換する", async()=>{
  const p1=rowsOf(1000,i=>({record_date:"2026-03-29",kind:"現金",item:"財布"+i,amount:"1"}));
  const p2=[{record_date:"2026-04-28",kind:"現金",item:"現ナマ",amount:"230000"}];
  await withEnv(CFG,[{body:p1},{body:p2},{body:[]}], async(mf)=>{
    const r=await sbLoadMonthlyAssets();
    eq(r.length,1001);
    eq(r[1000],{date:"2026-04-28",kind:"現金",item:"現ナマ",amount:230000});
    eq(mf.calls.length,3);
    assert(mf.calls[0].url.includes("monthly_assets?select=record_date,kind,item,amount&order=record_date.asc,kind.asc,item.asc"), mf.calls[0].url);
    assert(mf.calls[0].url.endsWith("&limit=1000&offset=0"), mf.calls[0].url);
    assert(mf.calls[1].url.endsWith("&offset=1000"), mf.calls[1].url);
    assert(mf.calls[2].url.endsWith("&offset=1001"), mf.calls[2].url);
    eq(statText(),"DB同期済");
  });
});

test("sbLoadMonthlyAssets: 途中のページで失敗したらnull", async()=>{
  await withEnv(CFG,[{body:rowsOf(1000,()=>({record_date:"2026-03-29",kind:"a",item:"b",amount:1}))},{ok:false,status:500}], async()=>{
    eq(await sbLoadMonthlyAssets(),null);
    eq(statText(),"DB同期失敗");
  });
});

test("sbLoadMonthlyAssets / sbLoadAllHoldings: 未設定なら通信せずnull", async()=>{
  await withEnv(null,[], async(mf)=>{
    eq(await sbLoadMonthlyAssets(),null);
    eq(await sbLoadAllHoldings(),null);
    eq(mf.calls.length,0);
  });
});

test("sbLoadAllHoldings: 必要な列だけを日付順に取り、欠損を空文字に寄せる", async()=>{
  await withEnv(CFG,[{body:[
    {snapshot_date:"2026-09-15",broker:"SBI",code:"現金",value:"120"},
    {snapshot_date:"2026-09-15",broker:null,code:null,value:"5"},
  ]},{body:[]}], async(mf)=>{
    eq(await sbLoadAllHoldings(),[
      {date:"2026-09-15",broker:"SBI",code:"現金",value:120},
      {date:"2026-09-15",broker:"",code:"",value:5},
    ]);
    assert(mf.calls[0].url.includes("holdings?select=snapshot_date,broker,code,value&order=snapshot_date.asc,id.asc&limit=1000&offset=0"), mf.calls[0].url);
  });
});

test("sbSaveMonthlyAssets: 全件消してから500行ずつ入れる", async()=>{
  const rows=rowsOf(1200,i=>({date:"2026-03-29",kind:"現金",item:"x"+i,amount:i}));
  await withEnv(CFG,[{},{},{},{}], async(mf)=>{
    eq(await sbSaveMonthlyAssets(rows),true);
    eq(mf.calls.map(c=>c.method),["DELETE","POST","POST","POST"]);
    assert(mf.calls[0].url.endsWith("monthly_assets?record_date=gt.1900-01-01"), mf.calls[0].url);
    const b1=JSON.parse(mf.calls[1].body), b3=JSON.parse(mf.calls[3].body);
    eq(b1.length,500); eq(b3.length,200);
    eq(b1[0],{record_date:"2026-03-29",kind:"現金",item:"x0",amount:0});
    eq(statText(),"DB同期済");
  });
});

test("sbSaveMonthlyAssets: 削除に失敗したら入れずにfalse", async()=>{
  await withEnv(CFG,[{ok:false,status:500}], async(mf)=>{
    eq(await sbSaveMonthlyAssets([{date:"2026-03-29",kind:"a",item:"b",amount:1}]),false);
    eq(mf.calls.length,1);
    eq(statText(),"DB同期失敗");
  });
});

test("sbSaveMonthlyAssets: 未設定なら通信せずfalse", async()=>{
  await withEnv(null,[], async(mf)=>{
    eq(await sbSaveMonthlyAssets([]),false);
    eq(mf.calls.length,0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

`http://localhost:8734/test/supabase.test.html` を開く。
期待: `7 FAILED / 39 passed`

- [ ] **Step 3: `supabase.js` に3関数を追加する**

2行目のコメントを次に置き換える。

```js
// app.jsから使う入口は末尾の window.sb* に並べた関数。
```

`sbDeleteAll` の閉じ括弧の後ろ（`window.sbEnabled=sbEnabled;` の前）に追記する。

```js
  const PAGE=1000;
  const MAX_ROWS=200000;   // サーバーがoffsetを無視した場合に止まらなくなるのを防ぐ
  // PostgRESTは1回に返す行数に上限がある（Supabaseの既定は1000行）。空のページが返るまで続けて読む
  async function sbFetchAll(path){
    const out=[];
    while(out.length<MAX_ROWS){
      const res=await sbFetch(path+"&limit="+PAGE+"&offset="+out.length);
      if(!res) return null;
      let rows;
      try{ rows=await res.json(); }catch(e){ console.warn("[supabase] failed to parse "+path, e); return null; }
      if(!Array.isArray(rows)) return null;
      if(!rows.length) return out;
      out.push(...rows);
    }
    return out;
  }

  // 月次資産（Excelの元の行）を取得する。失敗はnull、DBが空なら空配列
  async function sbLoadMonthlyAssets(){
    if(!sbEnabled()) return null;
    const rows=await sbFetchAll("monthly_assets?select=record_date,kind,item,amount&order=record_date.asc,kind.asc,item.asc");
    if(!rows){ sbStatus("error"); return null; }
    sbStatus("ok");
    return rows.map(r=>({date:r.record_date, kind:r.kind, item:r.item, amount:Number(r.amount)}));
  }

  // 資産全体の合算に使うため、全日付の保有明細を必要な列だけ取得する
  async function sbLoadAllHoldings(){
    if(!sbEnabled()) return null;
    const rows=await sbFetchAll("holdings?select=snapshot_date,broker,code,value&order=snapshot_date.asc,id.asc");
    if(!rows){ sbStatus("error"); return null; }
    sbStatus("ok");
    return rows.map(r=>({date:r.snapshot_date, broker:r.broker||"", code:r.code||"", value:Number(r.value)}));
  }

  const CHUNK=500;
  // 月次資産を保存する。ブックに全年度が入っているので、差分を取らずに全件入れ替える
  async function sbSaveMonthlyAssets(rows){
    if(!sbEnabled()) return false;
    const del=await sbFetch("monthly_assets?record_date=gt.1900-01-01", {
      method:"DELETE",
      headers:{"Prefer":"return=minimal"}
    });
    if(!del){ sbStatus("error"); return false; }
    const body=(rows||[]).map(r=>({record_date:r.date, kind:r.kind, item:r.item, amount:r.amount}));
    for(let i=0;i<body.length;i+=CHUNK){
      const ins=await sbFetch("monthly_assets", {
        method:"POST",
        headers:{"Prefer":"return=minimal"},
        body:body.slice(i,i+CHUNK)
      });
      if(!ins){ sbStatus("error"); return false; }
    }
    sbStatus("ok");
    return true;
  }
```

公開部分の `window.sbDeleteAll=sbDeleteAll;` の後ろに追記する。

```js
  window.sbLoadMonthlyAssets=sbLoadMonthlyAssets;
  window.sbLoadAllHoldings=sbLoadAllHoldings;
  window.sbSaveMonthlyAssets=sbSaveMonthlyAssets;
```

- [ ] **Step 4: テストが通ることを確認する**

テストページを再読み込みする。
期待: `ALL PASS (46)`

- [ ] **Step 5: Workerの中継許可に追加する**

`worker/worker.js:7` を次に置き換える。

```js
const TABLE_PATH = /^(snapshots|holdings|monthly_assets)$/;   // 中継してよいテーブル
```

確認: `node -e "import('./worker/worker.js').then(()=>console.log('ok'))"` を実行し、`ok` が出ること（構文エラーがないこと）。

- [ ] **Step 6: 設計書の4.3を実装に合わせる**

`docs/superpowers/specs/2026-10-14-total-assets-design.md` の 4.3 の表のうち `sbLoadBrokerTotals()` の行と、その下の説明1行を、次に置き換える。

```markdown
| `sbLoadAllHoldings()` | `Promise<Array\|null>` | 全日付の保有明細を `[{date, broker, code, value}]` で返す |

日付・証券会社ごとの合計と外貨預り金（`code === "現金"` の行）の集計は、`assets.js` の純粋関数 `summarizeHoldings()` で行う。CSVを読み込んだ直後にも、DBを経由せず同じ集計を使うため。
```

- [ ] **Step 7: コミット**

```bash
git add supabase.js test/supabase.test.html worker/worker.js docs/superpowers/specs/2026-10-14-total-assets-design.md
git commit -m "月次資産の保存・読み込みと保有明細の一括取得を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 資産全体セクションの画面

**Files:**
- Modify: `portfolio_app.html`（ツールバー、資産全体セクション、推移の期間ボタンにid、スクリプト読み込み）
- Modify: `style.css`（スタイル追加）
- Modify: `app.js`（資産全体の処理を追加、既存の4か所にフック）
- Modify: `worker/build.mjs`

**Interfaces:**
- Consumes: Task 1・2 の `workbookToSheets` / `parseAssetSheets` / `summarizeHoldings` / `combineMonthly` / `ASSET_CATS`、Task 3 の `sbSaveMonthlyAssets` / `sbLoadMonthlyAssets` / `sbLoadAllHoldings`、既存の `fmt` / `NS` / `svgText` / `niceCeil` / `isoLocal` / `tipEl` / `moveTip` / `hideTip` / `touchUI` / `histNarrow`
- Produces: 画面のみ（他タスクから使う関数はない）

- [ ] **Step 1: HTMLを変更する**

(a) ツールバーの「CSV読込」の `</label>` の直後に追加する。

```html
    <label class="tbtn" title="月次資産のExcel（〇〇〇〇年度　資産 シート）を読み込み">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
      資産Excel
      <input type="file" id="xlsxFile" accept=".xlsx" hidden>
    </label>
```

(b) `<!-- section header -->` の直前に追加する。

```html
  <!-- total assets -->
  <div class="total-wrap">
    <div class="card">
      <div class="card-title">
        <span>資産全体 <small id="taInfo"></small></span>
      </div>
      <div class="hist-stat">
        <span class="hd" id="taDate">–</span>
        <span class="hl">総資産</span><b id="taTotal">–</b>
        <span class="hl">前月比</span><b id="taDiff">–</b><b id="taDiffP"></b>
      </div>
      <div class="hist-ctrl">
        <div class="hseg" id="taSeg">
          <button data-r="12" class="on">1年</button>
          <button data-r="36">3年</button>
          <button data-r="0">全期間</button>
        </div>
        <span class="hrange" id="taRange"></span>
      </div>
      <div class="hist-body">
        <svg id="taSvg" viewBox="0 0 1040 280"></svg>
      </div>
      <div id="taDetail" class="chart-detail" hidden></div>
      <div class="ta-mix" id="taMix"></div>
    </div>
  </div>
```

(c) 推移グラフの期間ボタン `<div class="hseg">`（`data-r="3"` のボタンを含むもの）を `<div class="hseg" id="histSeg">` にする。

(d) 末尾のスクリプト読み込みを次に置き換える（`?v=` も更新する）。

```html
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<script src="sectors.js?v=20261014a"></script>
<script src="assets.js?v=20261014a"></script>
<script src="supabase-config.js"></script>
<script src="supabase.js?v=20261014a"></script>
<script src="app.js?v=20261014a"></script>
```

`<link rel="stylesheet" href="style.css?v=20261012c">` も `?v=20261014a` にする。

- [ ] **Step 2: CSSを追加する**

`style.css` の `.hist-body{padding:12px 18px 18px;}` の行の直後に追加する。

```css
  /* 資産全体（月次資産Excel＋CSV） */
  .total-wrap{padding:24px 32px 0;}
  #taSvg .ta-bar{transition:opacity .2s;}
  #taSvg.has-sel .ta-bar:not(.sel){opacity:.3;}
  .tip-r .tip-dot{display:inline-block;margin-right:6px;vertical-align:middle;}
  .ta-mix{padding:0 28px 22px;}
  .ta-mixbar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--line-soft);}
  .ta-mixlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 24px;margin-top:14px;}
  .ta-mixrow{display:flex;align-items:center;gap:8px;font-size:13px;}
  .ta-mixrow i{width:9px;height:9px;border-radius:3px;flex-shrink:0;}
  .ta-mixrow span{color:var(--muted);flex:1;}
  .ta-mixrow b{font-family:"Sora";font-weight:600;}
  .ta-mixrow em{font-style:normal;font-family:"Sora";font-size:12px;color:var(--muted);width:46px;text-align:right;}
```

`@media(max-width:640px){` ブロック内の `.hist-wrap{padding:0 16px 32px;}` の直後に追加する。

```css
    .total-wrap{padding:16px 16px 0;}
    .ta-mix{padding:0 18px 18px;}
    .ta-mixlist{grid-template-columns:1fr;}
```

- [ ] **Step 3: 既存の期間ボタンの選択を `#histSeg` に絞る**

`app.js` の「期間切替（直近3ヶ月 / 半年 / 1年 / 全期間）」のブロックで、`".hseg button"` を2か所とも `"#histSeg button"` に置き換える。

- [ ] **Step 4: 資産全体の処理を追加する**

`app.js` の `// ===== 資産推移（CSV読込時にブラウザへ自動記録） =====` の行の**直前**に追加する（`?del=` の削除処理が起動時に `setLocalBrokerDay` を呼ぶため、変数はこれより前で宣言しておく必要がある）。

```js
// ===== 資産全体（月次資産Excel＋CSVの合算） =====
const MA_KEY="kabu_monthly_assets_v1";
let maLocalWrite=false;     // 起動後にExcelを読み込んだか（DBからの読み戻しで上書きしないため）
let BT_DB=[];               // DBの保有明細から集計した、日付・証券会社ごとの合計
const BT_LOCAL=new Map();   // この画面で読み込んだ日（値は集計結果）と削除した日（値はnull）。DBより優先する
let btCleared=false;        // 履歴クリア後は、DBの読み戻し結果を使わない
const taSvg=document.getElementById("taSvg");
const taDetail=document.getElementById("taDetail");
let taRange=12;             // 表示期間（月数、0=全期間）
let taW=1040;
let TBARS=[];               // ホバー・タップ検索用の棒の座標
let taSel=-1;               // スマホでタップ中の棒（TBARSの添字）

function loadMA(){
  try{ const a=JSON.parse(localStorage.getItem(MA_KEY)); return Array.isArray(a)?a:[]; }
  catch{ return []; }
}
function saveMA(rows){ try{ localStorage.setItem(MA_KEY,JSON.stringify(rows)); }catch{} }

function brokerTotals(){
  const out=BT_DB.filter(b=>!BT_LOCAL.has(b.date));
  for(const v of BT_LOCAL.values()) if(v) out.push(...v);
  return out;
}
// CSVを読み込んだ日（rows）・削除した日（null）を、資産全体の合算に反映する
function setLocalBrokerDay(day,rows){
  BT_LOCAL.set(day, rows ? summarizeHoldings(rows.map(r=>({date:day,broker:r.broker,code:r.code,value:r.value}))) : null);
  renderTotal();
}
function taMsg(t){ document.getElementById("taInfo").textContent=t; }
const yen=v=>"¥"+fmt(Math.round(v));
const posSum=m=>ASSET_CATS.reduce((s,c)=>s+Math.max(0,m.cats[c.key]),0);

function taTipHTML(m){
  const src=m.csvDate ? "CSV "+m.csvDate.replace(/-/g,"/")+" ＋ Excel" : "Excelのみ";
  return `<div class="tip-h"><b>${m.date.replace(/-/g,"/")}</b><small>${src}</small></div>`+
    ASSET_CATS.filter(c=>m.cats[c.key]).map(c=>
      `<div class="tip-r"><span><span class="tip-dot" style="background:${c.color}"></span>${c.label}</span>`+
      `<b>${yen(m.cats[c.key])}</b></div>`).join("")+
    `<div class="tip-r"><span>合計</span><b>${yen(m.total)}</b></div>`;
}

function taClearSel(){
  TBARS.forEach(b=>b.g.classList.remove("sel"));
  taSel=-1;
  taSvg.classList.remove("has-sel");
  taDetail.hidden=true;
}

function renderMix(m){
  const parts=ASSET_CATS.map(c=>({c,v:Math.max(0,m.cats[c.key])})).filter(x=>x.v>0);
  const sum=parts.reduce((s,x)=>s+x.v,0)||1;
  document.getElementById("taMix").innerHTML=
    `<div class="ta-mixbar">${parts.map(x=>`<span style="width:${x.v/sum*100}%;background:${x.c.color}"></span>`).join("")}</div>`+
    `<div class="ta-mixlist">${parts.map(x=>
      `<div class="ta-mixrow"><i style="background:${x.c.color}"></i><span>${x.c.label}</span>`+
      `<b>${yen(x.v)}</b><em>${(x.v/sum*100).toFixed(1)}%</em></div>`).join("")}</div>`;
}

function renderTotal(){
  const all=combineMonthly(loadMA(),brokerTotals());
  taClearSel();
  taSvg.innerHTML=""; TBARS=[];
  const sp=histNarrow.matches;
  const W=sp?420:1040, H=sp?300:280, padL=sp?8:24, padR=sp?86:92, padT=14, padB=sp?40:44;
  const fs=sp?14:11.5;
  taW=W;
  taSvg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  const dEl=document.getElementById("taDate"), tEl=document.getElementById("taTotal"),
        fEl=document.getElementById("taDiff"), pEl=document.getElementById("taDiffP");
  if(!all.length){
    dEl.textContent="–"; tEl.textContent="–"; fEl.textContent="–"; pEl.textContent="";
    fEl.className=""; pEl.className="";
    document.getElementById("taRange").textContent="";
    document.getElementById("taMix").innerHTML="";
    svgText({x:W/2,y:H/2,fill:"#8a909c","font-size":14,"font-weight":600,
      "font-family":"Zen Kaku Gothic New","text-anchor":"middle",
      t:"資産Excelを読み込むと、預金なども含めた資産全体を表示します"},taSvg);
    return;
  }
  const last=all[all.length-1], prev=all[all.length-2];
  dEl.textContent=last.date.replace(/-/g,"/");
  tEl.textContent=fmt(Math.round(last.total))+"円";
  if(prev){
    const d=last.total-prev.total, pct=prev.total?d/prev.total*100:0, sg=d>=0?"+":"";
    fEl.textContent=sg+fmt(Math.round(d))+"円";
    pEl.textContent=sg+pct.toFixed(1)+"%";
    fEl.className=pEl.className=d>=0?"pos":"neg";
  }else{
    fEl.textContent="–"; pEl.textContent=""; fEl.className=""; pEl.className="";
  }
  renderMix(last);
  // 期間は最新の記録日から数える（Excelの更新が止まっていても空にならないように）
  let list=all;
  if(taRange){
    const [y,m,d]=last.date.split("-").map(Number);
    const cut=isoLocal(new Date(y,m-1-taRange,d).getTime());
    list=all.filter(x=>x.date>cut);
  }
  document.getElementById("taRange").textContent=
    list[0].date.replace(/-/g,"/")+" ～ "+last.date.replace(/-/g,"/");
  const top=niceCeil(Math.max(...list.map(posSum))*1.05);
  const Y=v=>padT+(1-v/top)*(H-padT-padB);
  for(let i=0;i<=4;i++){
    const v=top*i/4, y=Y(v);
    const ln=document.createElementNS(NS,"line");
    ln.setAttribute("x1",padL);ln.setAttribute("x2",W-padR);
    ln.setAttribute("y1",y);ln.setAttribute("y2",y);
    ln.setAttribute("stroke","#1c2030");
    taSvg.appendChild(ln);
    svgText({x:W-padR+8,y,fill:"#7e8496","font-size":fs,"font-family":"Sora",
      "text-anchor":"start","dominant-baseline":"central",
      t: v===0 ? "0円" : fmt(Math.round(v/10000))+"万円"},taSvg);
  }
  const slot=(W-padL-padR)/list.length, bw=Math.max(2,Math.min(36,slot*0.66));
  list.forEach((m,i)=>{
    const cx=padL+slot*(i+0.5);
    const g=document.createElementNS(NS,"g");
    g.setAttribute("class","ta-bar");
    let acc=0;
    for(const c of ASSET_CATS){
      const v=Math.max(0,m.cats[c.key]);   // 負の値（SBI預金の差し引き）は棒に描かない
      if(!v) continue;
      const r=document.createElementNS(NS,"rect");
      r.setAttribute("x",cx-bw/2); r.setAttribute("width",bw);
      r.setAttribute("y",Y(acc+v)); r.setAttribute("height",Math.max(0,Y(acc)-Y(acc+v)));
      r.setAttribute("fill",c.color);
      g.appendChild(r);
      acc+=v;
    }
    if(m.csvDate){                          // CSVで置き換えた月の印
      const dot=document.createElementNS(NS,"circle");
      dot.setAttribute("cx",cx); dot.setAttribute("cy",H-padB+8); dot.setAttribute("r",2.5);
      dot.setAttribute("fill","#e3c477");
      g.appendChild(dot);
    }
    taSvg.appendChild(g);
    TBARS.push({x:cx,g,m});
  });
  const step=Math.max(1,Math.ceil(list.length/(sp?4:6)));
  list.forEach((m,i)=>{
    if(i%step!==0 && i!==list.length-1) return;
    svgText({x:padL+slot*(i+0.5),y:H-padB+26,fill:"#7e8496","font-size":fs-0.5,"font-family":"Sora",
      "text-anchor":"middle",t:m.date.slice(2,7).replace("-","/")},taSvg);
  });
}

function taNearest(e){
  const r=taSvg.getBoundingClientRect();
  const x=(e.clientX-r.left)/r.width*taW;
  let best=null;
  for(const b of TBARS) if(!best||Math.abs(b.x-x)<Math.abs(best.x-x)) best=b;
  return best;
}
taSvg.addEventListener("mousemove",e=>{
  if(touchUI.matches||!TBARS.length) return;
  tipEl.innerHTML=taTipHTML(taNearest(e).m);
  tipEl.style.display="block";
  moveTip(e);
});
taSvg.addEventListener("mouseleave",()=>{ if(!touchUI.matches) hideTip(); });
// スマホ：タップした月以外を暗くし、グラフ下に内訳を出す。同じ月をもう一度タップで解除
taSvg.addEventListener("click",e=>{
  if(!touchUI.matches||!TBARS.length) return;
  e.stopPropagation();                      // 外側タップの解除処理に届かせない
  const b=taNearest(e), i=TBARS.indexOf(b);
  if(i===taSel){ taClearSel(); return; }
  taClearSel();
  taSel=i;
  b.g.classList.add("sel");
  taSvg.classList.add("has-sel");
  taDetail.innerHTML=taTipHTML(b.m);
  taDetail.hidden=false;
});
document.addEventListener("click",()=>{ if(taSel>=0) taClearSel(); });

document.querySelectorAll("#taSeg button").forEach(b=>{
  b.addEventListener("click",()=>{
    document.querySelectorAll("#taSeg button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    taRange=parseInt(b.dataset.r,10)||0;
    renderTotal();
  });
});

document.getElementById("xlsxFile").addEventListener("change",async e=>{
  const f=e.target.files[0];
  e.target.value="";                        // 同じファイルを選び直しても反応させる
  if(!f) return;
  if(!window.XLSX){ taMsg("Excel読み込み用のライブラリを読み込めませんでした（ネット接続を確認してください）"); return; }
  let res;
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{cellDates:true});
    res=parseAssetSheets(workbookToSheets(wb));
  }catch(err){
    console.warn("[assets] failed to read workbook", err);
    taMsg("Excelファイルを読み込めませんでした");
    return;
  }
  if(!res.rows.length){ taMsg("『〇〇〇〇年度　資産』シートが見つかりませんでした"); return; }
  saveMA(res.rows);
  maLocalWrite=true;
  renderTotal();
  taMsg(res.years+"年度分・"+res.months+"か月を取り込みました");
  sbSaveMonthlyAssets(res.rows);            // DB保存は待たない（失敗時は「DB同期失敗」表示）
});
```

- [ ] **Step 5: 既存処理にフックを差す**

(a) `saveSnapshot` の `sbSaveSnapshot({date:day,total,cost,rows:RAW});` の行の直後に追加する。

```js
  setLocalBrokerDay(day,RAW);                      // 資産全体の合算にもすぐ反映する
```

(b) `delHistoryDay` の `sbDeleteDay(day);` の行の直前に追加する。

```js
  setLocalBrokerDay(day,null);                     // 資産全体の合算からも外す
```

(c) 履歴クリアの `sbDeleteAll();` の行の直前に追加する。

```js
    BT_DB=[]; BT_LOCAL.clear(); btCleared=true;      // 資産全体の合算からもCSVを外す
    renderTotal();
```

(d) `app.js` の末尾（`hydrateFromDB` の即時関数の後ろ）に追加する。

```js
// ===== 資産全体の起動時表示と読み戻し =====
histNarrow.addEventListener("change",()=>renderTotal());
renderTotal();

// 月次資産と保有明細をSupabaseから読み戻す。localStorageの月次資産は同期キャッシュ扱い
(async function hydrateTotalFromDB(){
  if(!sbEnabled()) return;
  const [ma,hold]=await Promise.all([sbLoadMonthlyAssets(),sbLoadAllHoldings()]);
  if(ma&&ma.length&&!maLocalWrite) saveMA(ma);   // DBが空・失敗なら手元のキャッシュを残す
  if(hold&&!btCleared) BT_DB=summarizeHoldings(hold);
  renderTotal();
})();
```

- [ ] **Step 6: 公開用ビルドに `assets.js` を含める**

`worker/build.mjs` の `FILES` の `"sectors.js": "sectors.js",` の直後に追加する。

```js
  "assets.js": "assets.js",
```

確認: `node worker/build.mjs` を実行し、`dist/ に 7 ファイルをコピーしました` と出ること。確認後 `dist/` は gitignore 済みなのでそのままでよい。

- [ ] **Step 7: ユニットテストが壊れていないことを確認する**

`test/assets.test.html` が `ALL PASS (22)`、`test/supabase.test.html` が `ALL PASS (46)` であること。

- [ ] **Step 8: iframeハーネスで画面を確認する（PC幅）**

**本番DBに触れないよう、必ずこのハーネスを使うこと。**

新しいタブで `http://localhost:8734/test/supabase.test.html?host=1` を `force: true` で開き、`javascript_tool` で以下を実行する。

```js
(async()=>{
  if(window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) return '中止: 土台ページに実設定';
  const bust='ta'+Date.now();
  let html = await (await fetch('/portfolio_app.html',{cache:'no-store'})).text();
  html = html.replace(/(src|href)="((?:sectors|assets|supabase|app|style)[^"]*?)(\?v=[^"]*)?"/g,(m,a,f)=>`${a}="/${f}?${bust}"`);
  const MA=[];
  const add=(date,k,i,a)=>MA.push({record_date:date,kind:k,item:i,amount:String(a)});
  ["2026-07-28","2026-08-26","2026-09-29"].forEach((d,n)=>{
    add(d,"株式","楽天証券",1000000+n*10000); add(d,"株式","SBI証券",2000000);
    add(d,"株式","企業DC",300000); add(d,"口座預金","SBI証券",400000);
    add(d,"口座預金","楽天銀行",600000); add(d,"仮想通貨","BTC",50000); add(d,"現金","現ナマ",20000);
  });
  html = html.replace(/<script src="[^"]*supabase-config[^"]*"><\/script>/,
    `<script>
       window.SUPABASE_CONFIG={url:"https://fake.supabase.co",key:"k"};
       window.__hits=[];
       const MA=${JSON.stringify(MA)};
       const page=(url,rows)=>{ const off=+(url.match(/offset=(\\d+)/)||[0,0])[1]; return rows.slice(off,off+1000); };
       window.fetch=async(u,o)=>{
         const url=String(u); window.__hits.push(((o&&o.method)||'GET')+' '+url);
         const ok=b=>({ok:true,status:200,json:async()=>b,text:async()=>JSON.stringify(b)});
         if(url.includes('/monthly_assets?select=')) return ok(page(url,MA));
         if(url.includes('/holdings?select=snapshot_date,broker')) return ok(page(url,[
           {snapshot_date:"2026-09-15",broker:"SBI",code:"7203",value:"2500000"},
           {snapshot_date:"2026-09-15",broker:"SBI",code:"現金",value:"100000"}]));
         return ok([]); };
     </script>`);
  html = html.replace('<head>','<head><base href="/">');
  const saved=localStorage.getItem('kabu_monthly_assets_v1');
  localStorage.removeItem('kabu_monthly_assets_v1');
  const old=document.getElementById('taFrame'); if(old) old.remove();
  const ifr=document.createElement('iframe'); ifr.id='taFrame';
  ifr.style.cssText='width:1200px;height:900px;border:0'; ifr.srcdoc=html;
  document.body.appendChild(ifr);
  await new Promise(r=>ifr.addEventListener('load',r,{once:true}));
  await new Promise(r=>setTimeout(r,900));
  const d=ifr.contentDocument, w=ifr.contentWindow;
  const out={
    総資産:d.getElementById('taTotal').textContent,
    前月比:d.getElementById('taDiff').textContent,
    記録日:d.getElementById('taDate').textContent,
    棒:d.querySelectorAll('#taSvg .ta-bar').length,
    CSV印:d.querySelectorAll('#taSvg .ta-bar circle').length,
    内訳:[...d.querySelectorAll('.ta-mixrow span')].map(e=>e.textContent),
    推移の期間ボタン:d.querySelectorAll('#histSeg button').length,
    エラー:w.__err||null
  };
  if(saved===null) localStorage.removeItem('kabu_monthly_assets_v1'); else localStorage.setItem('kabu_monthly_assets_v1',saved);
  return JSON.stringify(out,null,1);
})()
```

期待（9月は 9/15 のSBI CSVで置き換え。SBI CSVの合計は外貨預り金を含めて 2,600,000。証券 1,020,000＋2,600,000、預金 400,000−100,000＋600,000）:
- `総資産` が `4,890,000円`（証券 3,620,000 / 企業DC 300,000 / 預金 900,000 / 仮想通貨 50,000 / 現金 20,000）
- `前月比` が `+510,000円`（8月は 1,010,000＋2,000,000＋300,000＋1,000,000＋50,000＋20,000 = 4,380,000）
- `記録日` が `2026/09/29`、`棒` が `3`、`CSV印` が `1`
- `内訳` が `["証券","企業DC・持株","預金","仮想通貨","現金・電子マネー"]`
- `推移の期間ボタン` が `4`

続けてスクリーンショットを撮り（iframeが見える位置までスクロール）、棒グラフ・内訳の帯・総資産の表示が崩れていないことを目視で確認する。

- [ ] **Step 9: DBが空でも手元のキャッシュを残すことを確認する**

Step 8 のスクリプトを次の2点だけ変えて実行する。
- `/monthly_assets?select=` の応答を `ok([])` にする
- iframeを作る前に `localStorage.setItem('kabu_monthly_assets_v1', JSON.stringify([{date:"2026-09-29",kind:"現金",item:"現ナマ",amount:123}]))` を入れる（後片付けの復元処理はそのまま）

期待: `総資産` が `123円`、`棒` が `1`

- [ ] **Step 10: スマホ幅でタップ詳細を確認する**

`resize_window { preset: "mobile" }` にしてから土台ページを再読み込みし、Step 8 のスクリプトの iframe の幅を `375px`、高さを `1400px` にして実行する。続けて同じタブで以下を実行する。

```js
(()=>{
  const d=document.getElementById('taFrame').contentDocument;
  const svg=d.getElementById('taSvg'), r=svg.getBoundingClientRect();
  svg.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.right-60,clientY:r.top+r.height/2}));
  const a={詳細表示:!d.getElementById('taDetail').hidden, 詳細:d.getElementById('taDetail').textContent.slice(0,40),
    選択:d.querySelectorAll('#taSvg .ta-bar.sel').length, 横スクロール:d.documentElement.scrollWidth>d.documentElement.clientWidth};
  d.body.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  a.外タップ後=d.getElementById('taDetail').hidden;
  return JSON.stringify(a);
})()
```

期待: `詳細表示` が `true`、`詳細` が `2026/09/29` で始まる、`選択` が `1`、`横スクロール` が `false`、`外タップ後` が `true`

※ `touchUI`（`(hover:none)`）はモバイルプリセットで有効になる。もし `詳細表示` が `false` のままなら、iframe内で `matchMedia('(hover:none)').matches` を確認し、`false` ならタップ確認はスクリーンショットでの目視に切り替える。

確認後 `resize_window { preset: "desktop" }` で戻す。

- [ ] **Step 11: コミット**

```bash
git add portfolio_app.html style.css app.js worker/build.mjs
git commit -m "資産全体セクションを追加し、月次資産Excelを読み込めるようにする

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 実際のExcelで確認する（本番DBには書き込まない）

**Files:** なし（確認のみ。コードに問題が見つかったら該当タスクのファイルを直す）

**Interfaces:**
- Consumes: Task 4 までのすべて
- Produces: 確認結果（ユーザーへの報告）

- [ ] **Step 1: Excelを配信フォルダにコピーする**

`data/` は gitignore 済み。コピー元は読み取るだけで変更しない。

```bash
mkdir -p /c/work/02_programs/12_kabu/data && cp "/c/Users/kenta/OneDrive/デスクトップ/Foldas/02_生活/01_金/入江健太.Co 収支.xlsx" /c/work/02_programs/12_kabu/data/assets-check.xlsx
```

- [ ] **Step 2: ハーネスで読み込む**

Task 4 Step 8 のスクリプトを次のように変えて実行する。
- `/monthly_assets?select=` と `/holdings?select=snapshot_date,broker` の応答を両方 `ok([])` にする（CSVなし＝Excelの値だけで合算させる）
- iframe読み込み後、`await new Promise(r=>setTimeout(r,900));` の後ろで次を実行してファイルを読み込ませる

```js
  const buf=await (await fetch('/data/assets-check.xlsx',{cache:'no-store'})).arrayBuffer();
  const file=new File([buf],'assets.xlsx');
  const dt=new w.DataTransfer(); dt.items.add(file);
  const inp=d.getElementById('xlsxFile'); inp.files=dt.files;
  inp.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,1500));
  const rows=JSON.parse(w.localStorage.getItem('kabu_monthly_assets_v1'));
  const months=w.combineMonthly(rows,[]);
  const pick=dt0=>{ const m=months.find(x=>x.date===dt0); return m?Math.round(m.total):null; };
  out.メッセージ=d.getElementById('taInfo').textContent;
  out.月数=months.length;
  out.最初=months[0].date; out.最後=months[months.length-1].date;
  out.合計={"2022-04-02":pick("2022-04-02"),"2025-03-28":pick("2025-03-28"),
            "2026-03-29":pick("2026-03-29"),"2026-09-29":pick("2026-09-29")};
  out.POST=w.__hits.filter(h=>h.startsWith('POST')||h.startsWith('DELETE'));
```

（`out` を作る行を、この追加部分より前に移しておくこと）

期待:
- `メッセージ` が `5年度分・N か月を取り込みました` の形（N は `月数` と一致）
- `最初` が `2022-04-02`、`最後` が `2026-09-29`（記録日が1日もずれていないこと）
- `合計` が Excel の「合計」行と一致する: `2022-04-02` → `2888830`、`2025-03-28` → `15925816`、`2026-03-29` → `21777187`（2026年度シートの値）、`2026-09-29` → `25569183`
- `POST` に `https://fake.supabase.co/...monthly_assets` への DELETE と POST だけがあり、本番URLが含まれないこと

一致しない場合は、`rows` からその記録日の行を書き出し、Excelの該当列と突き合わせて原因（読み飛ばした行・二重に読んだ行）を特定する。

- [ ] **Step 3: 全期間表示をスクリーンショットで確認する**

iframe内の `#taSeg` の「全期間」ボタンをクリックし、2022年からの棒が並ぶことをスクリーンショットで確認する。

- [ ] **Step 4: コピーしたExcelを消す**

```bash
rm /c/work/02_programs/12_kabu/data/assets-check.xlsx
```

---

### Task 6: テーブル作成・README・本番への取り込み（ユーザー確認が必要）

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 3 のテーブル名・列名
- Produces: 本番の `monthly_assets` テーブルと、そこに入った月次資産

- [ ] **Step 1: READMEを更新する**

「主な機能」の「資産推移グラフ」の行の直後に追加する。

```markdown
- **資産全体（月次資産Excel）** — 「資産Excel」から月次資産のExcel（`〇〇〇〇年度　資産` シート）を読み込むと、預金・仮想通貨・企業DCなども含めた資産全体を月ごとの積み上げ棒グラフで表示する。楽天・SBIの証券はその月のCSVがあればCSVの値を使い、なければExcelの値を使う
```

テーブル作成SQL（`create index holdings_date_idx ...` の行の後ろ）に追加する。

```sql

create table monthly_assets (
  record_date date    not null,
  kind        text    not null,
  item        text    not null,
  amount      numeric not null,
  primary key (record_date, kind, item)
);
```

RLSポリシーの節がある場合は、`snapshots` / `holdings` と同じ形で `monthly_assets` の分も追記する（既存の書き方に合わせる）。

コミット:

```bash
git add README.md
git commit -m "READMEに資産全体と月次資産テーブルを追記する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 本番DBにテーブルを作る（ユーザーの許可を得てから）**

**ここで停止し、ユーザーに実行方法を確認すること。** 選択肢は (a) ユーザーが Supabase の SQL Editor で実行する、(b) 許可を得て Supabase MCP の `apply_migration` で実行する。実行するSQL:

```sql
create table monthly_assets (
  record_date date    not null,
  kind        text    not null,
  item        text    not null,
  amount      numeric not null,
  primary key (record_date, kind, item)
);

alter table monthly_assets enable row level security;
create policy "anon all" on monthly_assets for all to anon using (true) with check (true);
```

確認: `select count(*) from monthly_assets;` が `0` を返すこと。

- [ ] **Step 3: 本番に取り込む（ユーザーが操作）**

ユーザーにローカルの `portfolio_app.html`（`portfolio-local` で配信）を開いてもらい、「資産Excel」から実際のExcelを読み込んでもらう。

確認: ページの「DB同期済」表示と、`select count(*), min(record_date), max(record_date) from monthly_assets;` で件数・2022-04-02・2026-09-29 が返ること。

公開版（Cloudflare）への反映は、ユーザーが自分のコマンドプロンプトで `npm run cf:deploy` を実行する（エージェントはデプロイしない）。
