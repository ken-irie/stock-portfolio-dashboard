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

  window.workbookToSheets=workbookToSheets;
  window.parseAssetSheets=parseAssetSheets;
  window.summarizeHoldings=summarizeHoldings;
  window.combineMonthly=combineMonthly;
  window.ASSET_CATS=ASSET_CATS;

})();
