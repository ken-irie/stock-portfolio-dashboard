# Supabase連携設計 — 資産推移と保有明細のDB保存

作成日: 2026-08-13
対象リポジトリ: `stock-portfolio-dashboard`（公開リポジトリ）

## 1. 背景と目的

現在のアプリは完全にローカルで動く静的Webアプリで、資産推移をブラウザの localStorage（`kabu_asset_history_v1`）にのみ保存している。localStorage はブラウザのデータ消去で失われ、別のPCから見ることもできない。

そこで Supabase（PostgreSQL）を保存先として追加し、次を実現する。

- 日次の資産推移（日付・資産残高・元本）をDBに保存する
- その日の保有明細（全銘柄の評価額・取得額・数量・口座・証券会社・区分）もDBに保存する
- 起動時にDBから資産推移を読み戻し、Supabaseを正とする
- 別のPCで開いても同じ履歴が見える

## 2. 前提と決定事項

| 項目 | 決定 |
|---|---|
| 保存対象 | 資産推移＋保有明細の両方 |
| Supabaseプロジェクト | 未作成。本設計にDDLを含め、作成はユーザーが行う |
| 認証 | 使わない。接続情報を `supabase-config.js` に置き gitignore する |
| 読み戻し | 行う。Supabaseを正とし、localStorage はキャッシュとして残す |
| クライアント | 外部ライブラリを使わず、素の `fetch` で PostgREST REST API を直接叩く |

### 認証を使わない判断について

リポジトリが公開のため、anonキーを `app.js` に直接書くと誰でも読み書きできる状態になる。この点はユーザーに提示済みで、その上で「接続情報を gitignore 対象の別ファイルに退避する」方式が選択された。したがって**キーファイルを流出させないことがそのままアクセス制御になる**。

将来ログインを足す余地は残す。DBアクセスは `supabase.js` に閉じ込め、RLS も無効化ではなく「anonに全許可のポリシー」として明示的に張る。ログインを導入する際はポリシーの差し替えと `supabase.js` の変更だけで済み、`app.js` は触らない。

## 3. アーキテクチャ

### 3.1 ファイル構成

| ファイル | 扱い | 責務 |
|---|---|---|
| `supabase-config.js` | 新規・**gitignore** | 接続情報だけを持つ。`window.SUPABASE_CONFIG = { url, key }` |
| `supabase-config.example.js` | 新規・コミット | 上の雛形（値は空文字）。セットアップ時にコピーして使う |
| `supabase.js` | 新規・コミット | DBアクセス層。公開するのは後述の5関数のみ |
| `portfolio_app.html` | 変更 | `<script>` を2本追加、同期ステータス用の `<span id="dbStat">` を追加 |
| `app.js` | 変更 | 4か所にフックを差す |
| `.gitignore` | 変更 | `supabase-config.js` を追加 |
| `README.md` | 変更 | セットアップ手順を追記 |
| `test/supabase.test.html` | 新規・コミット | `supabase.js` の単体テスト |

`portfolio_app.html` のスクリプト読み込み順は次のとおり。`supabase-config.js` が存在しなくてもページは壊れない。

```html
<script src="sectors.js?v=..."></script>
<script src="supabase-config.js"></script>
<script src="supabase.js?v=..."></script>
<script src="app.js?v=..."></script>
```

### 3.2 `supabase.js` のインターフェース

`app.js` から見えるのは次の5つだけとする。すべて例外を投げない（内部で捕捉する）。

| 関数 | 戻り値 | 役割 |
|---|---|---|
| `sbEnabled()` | `boolean` | `window.SUPABASE_CONFIG` の `url` と `key` が両方とも非空文字なら `true` |
| `sbSaveSnapshot({date, total, cost, rows})` | `Promise<boolean>` | スナップショットと明細を保存 |
| `sbLoadHistory()` | `Promise<Array\|null>` | `[{date, total, cost}]` を昇順で返す。失敗時は `null` |
| `sbDeleteDay(date)` | `Promise<boolean>` | 指定日のスナップショットを削除（明細はcascadeで消える） |
| `sbDeleteAll()` | `Promise<boolean>` | 全スナップショットを削除 |

`sbLoadHistory()` の戻り値は既存の `loadHist()` と同じ形（`{date, total, cost}` の配列）にする。既存の描画コードをそのまま使うため。

内部には次を持つ。テストから差し替えられるよう、fetchは1か所に集約する。

- `sbFetch(path, options)` — 共通ヘッダ付与・タイムアウト・エラー捕捉を担う唯一のHTTP入口
- `sbStatus(state)` — 同期ステータス表示の更新（`unset` / `ok` / `error`）

## 4. DBスキーマ

Supabase の SQL Editor で実行する。

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

設計意図:

- `snapshot_date` を主キーにしたのは、既存の `saveSnapshot()` が「同じ日付の記録は上書き」という仕様のため。DB側の一意制約がそのまま同じ仕様になる
- `holdings` は `on delete cascade`。スナップショットを消せば明細も消える
- `holdings` の列は `RAW` の各行（`name, code, value, cost, cat, acct, qty, broker`）に1対1で対応させ、変換ロジックを挟まない
- `cat` は `jp` / `us` / `fund` / `bond` / `crypto` のいずれかだが、将来の区分追加に備えて `text` のままとし、CHECK制約は付けない

## 5. REST API の呼び出し仕様

ベースURL: `${SUPABASE_CONFIG.url}/rest/v1/`

共通ヘッダ:

```
apikey:        ${key}
Authorization: Bearer ${key}
Content-Type:  application/json
```

タイムアウトは `AbortSignal.timeout(10000)`（10秒）。

| 操作 | メソッド・パス | 追加ヘッダ |
|---|---|---|
| スナップショットupsert | `POST /snapshots` | `Prefer: resolution=merge-duplicates,return=minimal` |
| 明細の当日分削除 | `DELETE /holdings?snapshot_date=eq.<date>` | `Prefer: return=minimal` |
| 明細の一括投入 | `POST /holdings`（配列body） | `Prefer: return=minimal` |
| 履歴取得 | `GET /snapshots?select=snapshot_date,total_value,total_cost&order=snapshot_date.asc` | なし |
| 単日削除 | `DELETE /snapshots?snapshot_date=eq.<date>` | `Prefer: return=minimal` |
| 全削除 | `DELETE /snapshots?snapshot_date=gt.1900-01-01` | `Prefer: return=minimal` |

全削除にフィルタを付けているのは、PostgREST が無条件DELETEを既定で拒否するため。

upsert時の body は `updated_at` を明示的に含める（`default now()` は UPDATE 時には再適用されないため）。

```json
{ "snapshot_date": "2026-08-13", "total_value": 12345678, "total_cost": 9876543, "updated_at": "2026-08-13T09:00:00.000Z" }
```

`file://` から開いた場合、リクエストの Origin は `null` になる。Supabase の API ゲートウェイは全オリジンを許可するため、この構成で通信できる。

## 6. データフロー

### 6.1 起動直後の表示（確認済みの仕様）

ポートフォリオ部分（ドーナツ・サマリー・銘柄一覧）は**従来通り起動時は空**で、CSVを読み込むまで何も表示しない。保有明細はDBに保存するが読み戻さないため、別のPCで開いてもここは空のままである。DBから復元されるのは資産推移グラフだけになる。この挙動はユーザーに提示し、現行設計のまま進めることで合意済み。

DB取得中を示すインジケータは設けない。通常の応答は1秒未満で、一瞬だけ表示が切り替わるほうが煩わしいため。ステータス表示は取得が終わってから `DB同期済` を出す。

| タイミング | 表示 |
|---|---|
| 開いた瞬間 | ポートフォリオ部分は空・「CSV未読み込み」。推移グラフは localStorage の内容で即描画 |
| Supabase応答待ち | 上と同じ |
| 応答後 | 推移グラフのみDBの内容で再描画。ステータスが `DB同期済` に |

localStorage が空の新しいPCでは、応答が返るまで推移グラフも空になる。

### 6.2 起動時（hydrate）

`loadHist()` は同期関数で、`renderHistory()`・期間切替・グラフのホバー処理から繰り返し呼ばれている。これを非同期化すると描画コード全体に波及するため、**localStorage を同期キャッシュとして残し、起動時に Supabase の内容で丸ごと上書きする**方式を取る。既存の描画コードは変更しない。

`app.js:1090` の `renderHistory()`（初期表示）の直後にフックを差す。

1. これまで通り localStorage の内容で即描画する。Supabase未設定・オフラインでも表示は出る
2. `sbEnabled()` が false なら `sbStatus("unset")` にして終了
3. `sbLoadHistory()` を実行する
   - 成功 → localStorage を取得結果で置き換え、`renderHistory()` を再実行、`sbStatus("ok")`
   - 失敗（`null`）→ localStorage の内容のまま。`sbStatus("error")`

DBが空（初回起動）で localStorage に記録がある場合も、上書きの結果として履歴が消えたように見える。これを避けるため、**取得結果が空配列のときは localStorage を上書きしない**。既存の localStorage 履歴は、次回のCSV読込時に `sbSaveSnapshot()` 経由でDBへ入る。

### 6.3 CSV読込時（保存）

`app.js:858` の `saveSnapshot(dateStr)` の末尾にフックを差す。localStorage への書き込みと `renderHistory()` を先に済ませてから、DB書き込みを `await` せずに発火する（描画をネットワーク待ちにしない）。

`sbSaveSnapshot()` の内部は3ステップを直列に実行する。FK制約があるためこの順序は必須。

1. `snapshots` に upsert
2. `holdings` から当該日付を DELETE
3. `RAW` 全件を `holdings` に一括 INSERT

いずれかが失敗した時点で中断し `false` を返す。差分計算をせず delete → insert にしたのは、銘柄の増減を考慮せずに済むため。銘柄数は多くても数百件なので1リクエストに収まる。

3ステップすべて成功したら `sbStatus("ok")`、途中で失敗したら `sbStatus("error")` にする。

デモCSVの読込時は既存の `anyDummy` 判定により `saveSnapshot()` 自体が呼ばれない。したがってデモデータはDBにも入らない。

### 6.4 削除

- **履歴クリアボタン**（`app.js:1023`）— localStorage削除に加えて `sbDeleteAll()` を呼ぶ。確認ダイアログの文言を「資産推移の記録をすべて削除しますか？（Supabaseの記録も削除されます）」に変更する
- **`?del=YYYY-MM-DD`**（`app.js:1066` の `delHistoryDay`）— localStorage から削除したあと `sbDeleteDay(day)` を呼ぶ

### 6.5 同期ステータス表示

資産推移カードのヘッダにある `#histInfo` の隣に `<span id="dbStat">` を追加し、次の3状態を小さく表示する。

| 状態 | 表示 |
|---|---|
| `unset` | `DB未設定` |
| `ok` | `DB同期済` |
| `error` | `DB同期失敗` |

保存されたかどうかが分からない状態を避けるために設ける。スタイルは `#histInfo` と同じ `small` 系のトーンに揃える。

## 7. エラー処理

| 状況 | 挙動 |
|---|---|
| `supabase-config.js` が無い / `url` または `key` が空 | `sbEnabled()` が false。DB呼び出しは全てno-op。アプリは従来通りローカルで完結。表示は `DB未設定` |
| ネットワーク不通・4xx・5xx | `console.warn` にステータスコードとレスポンス本文を出し、表示を `DB同期失敗` に。**アラートは出さない**（CSV読込のたびにダイアログが出るため）。localStorage への書き込みは先に完了しているのでデータは失われない |
| 起動時のselect失敗 | localStorage の内容のまま描画を継続 |
| 応答が返らない | 10秒でタイムアウト。`file://` からの外部通信が環境的にブロックされていても固まらない |

`<script src="supabase-config.js">` の読み込み失敗自体はページを壊さない。判定は `window.SUPABASE_CONFIG` の有無で行う。

## 8. スコープ外（YAGNI）

次は今回入れない。

- 認証・ログイン画面
- Realtime購読
- 複数ユーザー対応
- 書き込み失敗時の再送キュー — 次にCSVを読み込めば同じ日付で upsert され結果的に追いつくため、複雑さに見合わない
- 推移グラフから過去日の保有明細を引く閲覧UI — 明細の保存だけ先に行い、閲覧は必要になってから

## 9. テスト方針

このプロジェクトはビルドもテストランナーも持たないため、それに合わせた形にする。

### 9.1 単体テスト `test/supabase.test.html`

ブラウザで開くと結果が表示される、依存ゼロのアサーション集。`sbFetch` の内部で使う `fetch` をモックに差し替えて検証する。

- `sbEnabled()` が config の有無・空文字で正しく切り替わる
- `sbSaveSnapshot()` が **snapshots upsert → holdings DELETE → holdings INSERT** の順にリクエストを出す
- upsert のリクエストに `Prefer: resolution=merge-duplicates` が付く
- `RAW` の行が `holdings` の列に正しく写る（`broker` / `acct` / `qty` が欠けている行を含む）
- upsert が失敗したら後続の DELETE / INSERT を実行せず `false` を返す
- fetch が reject しても例外を投げず、ステータスが `error` になる
- `sbLoadHistory()` が `{date, total, cost}` の配列を昇順で返す
- `sbLoadHistory()` が失敗時に `null` を返す（空配列と区別できる）
- `sbDeleteAll()` のURLに `snapshot_date=gt.1900-01-01` フィルタが含まれる

### 9.2 手動の結合確認

`demo/` のCSVは記録対象外なので、実データで確認する。

1. `supabase-config.js` を設定し、実データのCSVを1日分読み込む → `snapshots` に1行、`holdings` に銘柄数分の行が入る
2. 同じ日付のCSVを再度読み込む → `snapshots` は1行のまま、`holdings` も重複しない
3. localStorage を消してページを再読込 → Supabaseから履歴が復元される
4. 別ブラウザ（`supabase-config.js` を配置）で開く → 同じ履歴が見える
5. `supabase-config.js` を退避してページを開く → `DB未設定` 表示で、従来通り動作する
6. 「履歴クリア」実行 → `snapshots` と `holdings` の両方が空になる

## 10. セットアップ手順（READMEに追記する内容）

1. Supabase でプロジェクトを作成する
2. SQL Editor で本書「4. DBスキーマ」のDDLを実行する
3. Project Settings → API から Project URL と anon public key をコピーする
4. `supabase-config.example.js` を `supabase-config.js` にコピーし、値を貼り付ける
5. `portfolio_app.html` を開き、資産推移カードに `DB同期済` と出れば接続完了

`supabase-config.js` は gitignore 対象なので、別のPCで使うときは手動で配置する。**このファイルを公開リポジトリにコミットしないこと。** キーが漏れるとデータを誰でも読み書きできる状態になる。
