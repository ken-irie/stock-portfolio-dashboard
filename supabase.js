// Supabase(PostgREST)への保存・読み込み。外部ライブラリは使わない。
// app.jsから使う入口は末尾の window.sb* に並べた関数。
(function(){

  // 接続情報は呼び出しのたびに読む（スクリプトの読み込み順やテストでの差し替えに影響されないため）
  function cfg(){
    const c=window.SUPABASE_CONFIG;
    if(!c) return null;
    // 公開版（Cloudflare Workers）はWorkerが中継する。キーはサーバー側にだけ置く
    if(c.proxy) return {base:c.proxy, headers:{}, proxy:true};
    const url=(c.url||"").replace(/\/+$/,"");   // 末尾スラッシュを落として結合を安定させる
    const key=c.key||"";
    return (url&&key) ? {base:url+"/rest/v1/", headers:{"apikey":key, "Authorization":"Bearer "+key}} : null;
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

  const TIMEOUT=10000;   // file://から外部通信がブロックされている環境で固まらないよう打ち切る

  // HTTPの入口はここ1か所だけ。成功ならResponse、失敗ならnullを返す（例外は投げない）
  async function sbFetch(path, options){
    const c=cfg();
    if(!c) return null;
    const opt=options||{};
    const headers=Object.assign({}, c.headers, {"Content-Type":"application/json"}, opt.headers||{});
    try{
      const res=await window.fetch(c.base+path, {
        method:opt.method||"GET",
        headers,
        body:opt.body!==undefined ? JSON.stringify(opt.body) : undefined,
        signal:AbortSignal.timeout(TIMEOUT)
      });
      // ログインの有効期限が切れたらログイン画面へ戻す
      if(c.proxy && res.status===401){ window.location.href="/login"; return null; }
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

  // 月次資産を保存する。ブックに全年度が入っているので、差分を取らずに全件入れ替える。
  // INSERTは1回にまとめる（1文＝1トランザクションなので、途中までしか入らない状態にならない。
  // 一部だけ残ると、次回起動時にその欠けたデータで手元のキャッシュを上書きしてしまう）
  async function sbSaveMonthlyAssets(rows){
    if(!sbEnabled()) return false;
    const del=await sbFetch("monthly_assets?record_date=gt.1900-01-01", {
      method:"DELETE",
      headers:{"Prefer":"return=minimal"}
    });
    if(!del){ sbStatus("error"); return false; }
    const body=(rows||[]).map(r=>({record_date:r.date, kind:r.kind, item:r.item, amount:r.amount}));
    if(body.length){
      const ins=await sbFetch("monthly_assets", {
        method:"POST",
        headers:{"Prefer":"return=minimal"},
        body
      });
      if(!ins){ sbStatus("error"); return false; }
    }
    sbStatus("ok");
    return true;
  }

  window.sbEnabled=sbEnabled;
  window.sbStatus=sbStatus;
  window.sbLoadHistory=sbLoadHistory;
  window.sbLoadHoldings=sbLoadHoldings;
  window.sbSaveSnapshot=sbSaveSnapshot;
  window.sbDeleteDay=sbDeleteDay;
  window.sbDeleteAll=sbDeleteAll;
  window.sbLoadMonthlyAssets=sbLoadMonthlyAssets;
  window.sbSaveMonthlyAssets=sbSaveMonthlyAssets;

  // 設定が無いことは起動時点で分かるので、その場で表示しておく
  if(!sbEnabled()) sbStatus("unset");

})();
