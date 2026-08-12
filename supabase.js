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
