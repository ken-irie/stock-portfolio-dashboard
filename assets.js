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
