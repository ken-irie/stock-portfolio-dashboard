# 資産ポートフォリオ ダッシュボード

SBI証券・楽天証券の保有証券CSVを読み込んで、資産ポートフォリオを可視化するローカルWebアプリです。
**ビルド・サーバー不要で動作し、データはブラウザの外に一切送信されません。**

## ファイル構成

| ファイル | 内容 |
|---------|------|
| `portfolio_app.html` | 画面の骨組み |
| `style.css` | スタイル |
| `app.js` | ロジック（CSVパース・チャート描画・資産推移） |
| `sectors.js` | 銘柄のセクター分類 |
| `supabase.js` | Supabaseへの保存・読み込み（任意） |
| `supabase-config.js` | Supabaseの接続情報（任意・git管理外） |

同じフォルダに置いて使います。Supabase連携を使わない場合は最初の4ファイルだけで動きます。

## 使い方

1. リポジトリをクローン（またはZIPでダウンロード）し、`portfolio_app.html` をブラウザで開く（ダブルクリックでOK。サーバー不要）
2. 証券会社のサイトから保有証券一覧のCSVをダウンロードする
   - SBI証券: 口座管理 → 保有証券一覧 → CSVダウンロード
   - SBI証券（外国株）: 外国株式の保有証券一覧
   - 楽天証券: 保有商品一覧 → CSVで保存
3. 右上の「CSV読込」からCSVを選択（複数同時選択可）

## 主な機能

- **ドーナツチャート / ツリーマップ** — 評価額ベースの構成比を表示。スライスにホバーで詳細（評価額・構成比・保有数量・損益）
- **グルーピング** — 個別 / 証券会社 / セクター / 景気影響 / 口座 の軸で集計。クリックで内訳にドリルダウン
- **銘柄の自動合算** — 同じ銘柄を複数の証券会社で保有している場合は1つにまとめて表示（表記ゆれも吸収）
- **フィルター・並び替え** — 日本株 / 米国株 / 投信の絞り込み、金額 / 損益 / 名前での並び替え
- **[その他]集約スライダー** — 構成比の小さい銘柄をまとめて見やすく
- **資産推移グラフ** — CSVを読み込むたびにブラウザ(localStorage)へ自動記録し、資産残高と元本の推移を折れ線で表示。期間切替・ホバーで日別詳細

## 対応CSV形式

| 種別 | 判定方法 | 文字コード |
|------|---------|-----------|
| SBI証券（国内株・投信） | 保有証券一覧のCSV | Shift-JIS / UTF-8 自動判定 |
| SBI証券（外国株） | 外国株式保有一覧のCSV | 同上 |
| 楽天証券 | 保有商品詳細のCSV | 同上 |

- 記録の基準日はファイル名の日付（例: `SBI_20260628.csv` → 2026/06/28）から自動取得します
- 同じ種別のCSVを読み込み直すと最新の内容に置き換わります（二重計上しません）

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

## プライバシー

- Supabaseを設定しない場合、すべての処理はブラウザ内で完結します。外部サーバーへの通信は行いません（Webフォントの読み込みを除く）
- Supabaseを設定した場合のみ、資産推移と保有明細が自分のSupabaseプロジェクトへ送信されます
- 資産推移の記録はブラウザのlocalStorageに保存されます。「履歴クリア」ボタンでいつでも削除できます
- 保有明細CSVなどの個人データは `.gitignore` によりリポジトリへコミットされない設定になっています
