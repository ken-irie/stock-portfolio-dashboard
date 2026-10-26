// 月次資産Excelの読み取りと、月ごとの集計。DOMにもネットワークにも触らない純粋関数だけを置く。
// app.jsから使う入口は workbookToSheets / parseAssetSheets / combineMonthly / ASSET_CATS。
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
        const item=str(row[h.c+1])||k;      // 「ポケカ」のように資産欄が空の行は種類名を資産名にする
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
    {key:"pokeca",     label:"ポケカ",           color:"#ff6b8a"},
    {key:"other",      label:"その他",           color:"#7e8496"},
  ];
  const BOND_KINDS=new Set(["債権","債券"]);
  const DEPOSIT_KINDS=new Set(["口座預金","口座","証券口座","銀行貯金"]);
  const CASH_KINDS=new Set(["現金","電子マネー"]);

  // Excelの行を表示カテゴリに分ける
  function catOf(kind,item){
    if(kind==="株式") return (item.includes("楽天")||item.includes("SBI")) ? "securities" : "pension";
    if(BOND_KINDS.has(kind)) return item.includes("SBI") ? "securities" : "other";
    if(DEPOSIT_KINDS.has(kind)) return "deposit";
    if(kind==="仮想通貨") return "crypto";
    if(CASH_KINDS.has(kind)) return "cash";
    if(kind==="ポケカ") return "pokeca";
    return "other";
  }

  // Excelの記録日ごとに、カテゴリ別の金額と合計を出す（CSVは使わず、Excelの値をそのまま正とする）
  function combineMonthly(excelRows){
    const byDate=new Map();
    for(const r of excelRows||[]){
      if(!byDate.has(r.date)){
        const cats={};
        ASSET_CATS.forEach(c=>cats[c.key]=0);
        byDate.set(r.date,cats);
      }
      byDate.get(r.date)[catOf(r.kind,r.item)]+=r.amount;
    }
    return [...byDate.keys()].sort().map(date=>{
      const cats=byDate.get(date);
      return {date, total:ASSET_CATS.reduce((s,c)=>s+cats[c.key],0), cats};
    });
  }

  // 証券の行がどの証券会社のものか（CSVで差し替える対象）。証券以外はnull
  function brokerOf(kind,item){
    if(catOf(kind,item)!=="securities") return null;
    return item.includes("楽天") ? "楽天" : "SBI";
  }

  // 最後の記録日より後のCSV（holdings）で、Excelの最新月の楽天・SBIの証券だけを差し替えた「暫定」の月を出す。
  // 米ドル現金（code "現金"）はExcelの預金に入っているので数えない。差し替えられなければnull
  function provisionalMonth(excelRows,holdings){
    const months=combineMonthly(excelRows);
    if(!months.length) return null;
    const baseDate=months[months.length-1].date;
    const sums={};
    let date=null;
    for(const h of holdings||[]){
      if(!h||!h.date||h.date<=baseDate||(h.broker!=="楽天"&&h.broker!=="SBI")||h.code==="現金") continue;
      const v=Number(h.value);
      if(!isFinite(v)) continue;
      sums[h.broker]=(sums[h.broker]||0)+v;
      if(!date||h.date>date) date=h.date;
    }
    if(!date) return null;
    const cats={};
    ASSET_CATS.forEach(c=>cats[c.key]=0);
    for(const r of excelRows){
      if(r.date!==baseDate) continue;
      if(sums[brokerOf(r.kind,r.item)]!==undefined) continue;   // CSVのある証券会社はCSVの値を使う
      cats[catOf(r.kind,r.item)]+=r.amount;
    }
    for(const b in sums) cats.securities+=sums[b];
    return {date, baseDate, total:ASSET_CATS.reduce((s,c)=>s+cats[c.key],0), cats, provisional:true};
  }

  window.provisionalMonth=provisionalMonth;
  window.workbookToSheets=workbookToSheets;
  window.parseAssetSheets=parseAssetSheets;
  window.combineMonthly=combineMonthly;
  window.ASSET_CATS=ASSET_CATS;

})();
