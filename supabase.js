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

  window.sbEnabled=sbEnabled;
  window.sbStatus=sbStatus;
  window.sbLoadHistory=sbLoadHistory;
  window.sbSaveSnapshot=sbSaveSnapshot;

  // 設定が無いことは起動時点で分かるので、その場で表示しておく
  if(!sbEnabled()) sbStatus("unset");

})();
