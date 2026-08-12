const palette = ["#e3c477","#6f8ff2","#4fd6a5","#f0906b","#5bc6d8",
  "#c792ea","#f284a8","#a8cb6a","#f2c14e","#7fd1b9",
  "#e08a8a","#6d9be0","#d4a373","#8ad6a0","#b07be0","#5aa0d4",
  "#d68a8a","#a0d4c0","#c0a0e0","#d4b15a"];

let ALL = [];               // 個別表示用（同名合算後）
let RAW = [];               // 読み込んだ全銘柄（口座別・合算前）
let loadedNames = [];       // 読み込み済みファイル名
let groupMode = "individual"; // individual | sector | economic | account | broker
let drill = null;             // 展開中のグループキー
let sortKey = "value";        // value | pl | name
let sortDir = "desc";         // asc | desc
const NS="http://www.w3.org/2000/svg";

// セクターは sectors.js の SECTOR_MAP（東証33業種 / S&P500 GICS）を参照する。
// この SECTOR は SECTOR_MAP に無い銘柄（S&P500対象外の米国株など）のフォールバック用。
const SECTOR={
  "RPRX":"ヘルスケア","IONQ":"情報技術"
};
// 景気影響：景気敏感 / 景気中立 / ディフェンシブ の3分類
const ECO={
  "8058":"景気敏感","8031":"景気敏感","8035":"景気敏感","6861":"景気敏感","6954":"景気敏感",
  "7974":"景気中立","8766":"景気中立","8306":"景気敏感","9432":"ディフェンシブ","3197":"景気敏感","4755":"景気中立",
  "AAPL":"景気中立","MSFT":"景気中立","NVDA":"景気敏感","AMZN":"景気敏感",
  "DIS":"景気敏感","RPRX":"ディフェンシブ","JNJ":"ディフェンシブ","KO":"ディフェンシブ","PG":"ディフェンシブ",
  "BAC":"景気敏感","GOOG":"景気中立","INTC":"景気敏感","IONQ":"景気敏感","MU":"景気敏感","PLTR":"景気敏感"
};
function classify(d){
  if(d.cat==="fund"){ d.sector="投資信託";
    d.eco=/ゴールド|GOLD/i.test(d.name)?"ディフェンシブ":"景気中立"; }  // 株式インデックス投信は中立扱い
  else if(d.cat==="cash"){ d.sector="現金"; d.eco="ディフェンシブ"; }
  else if(d.cat==="bond"){ d.sector="債券"; d.eco="ディフェンシブ"; }
  else { d.sector=(typeof SECTOR_MAP!=="undefined"&&SECTOR_MAP[d.code])||SECTOR[d.code]||"その他株式";
         d.eco=ECO[d.code]||"景気中立"; }
  if(!d.acct) d.acct="その他";
}
const svg=document.getElementById("donut");
const fmt=n=>n.toLocaleString("ja-JP");
// CSV由来の文字列をHTMLに埋め込む際のエスケープ
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// ===== チャートのホバーツールチップ =====
const tipEl=document.getElementById("tip");
function tipHTML(d,total){
  const pl=d.value-d.cost, pct=d.cost?pl/d.cost*100:0, sg=pl>=0?"+":"";
  const share=total?d.value/total*100:0;
  const sub=d.code==="group"?d.count+"銘柄":(d.code==="other"?"まとめ表示":"");
  const qtyRow=(d.code!=="group"&&d.code!=="現金"&&d.code!=="other"&&d.qty>0)
    ? `<div class="tip-r"><span>保有数量</span><b>${fmt(d.qty)}${d.cat==="fund"?"口":"株"}</b></div>` : "";
  return `<div class="tip-h"><span class="tip-dot" style="background:${d.color}"></span>`+
    `<b>${esc(d.name)}</b>${sub?`<small>${sub}</small>`:""}</div>`+
    `<div class="tip-r"><span>評価額</span><b>¥${fmt(d.value)}</b></div>`+
    `<div class="tip-r"><span>構成比</span><b>${share.toFixed(1)}%</b></div>`+
    qtyRow+
    `<div class="tip-r"><span>取得金額</span><b>¥${fmt(d.cost)}</b></div>`+
    `<div class="tip-r"><span>評価損益</span>`+
    `<b class="${pl>=0?'pos':'neg'}">${sg}¥${fmt(pl)} (${sg}${pct.toFixed(2)}%)</b></div>`;
}
function moveTip(e){
  const pad=14, w=tipEl.offsetWidth, h=tipEl.offsetHeight;
  let x=e.clientX+pad, y=e.clientY+pad;
  if(x+w>window.innerWidth-8)  x=e.clientX-w-pad;
  if(y+h>window.innerHeight-8) y=e.clientY-h-pad;
  tipEl.style.left=x+"px"; tipEl.style.top=y+"px";
}
function showTip(e,d,total){
  tipEl.innerHTML=tipHTML(d,total);
  tipEl.style.display="block";
  moveTip(e);
}
function hideTip(){ tipEl.style.display="none"; }
// 資産推移グラフ用カード（日付・資産残高・評価損益）
function histTipHTML(h){
  const pl=h.total-h.cost, pct=h.cost?pl/h.cost*100:0, sg=pl>=0?"+":"";
  return `<div class="tip-h"><b>${h.date.replace(/-/g,"/")}</b></div>`+
    `<div class="tip-r"><span>資産残高</span><b>¥${fmt(h.total)}</b></div>`+
    `<div class="tip-r"><span>評価損益</span>`+
    `<b class="${pl>=0?'pos':'neg'}">${sg}¥${fmt(pl)} (${sg}${pct.toFixed(2)}%)</b></div>`;
}
// チャート領域にツールチップイベントを付与
function attachTip(el,d,total){
  el.addEventListener("mouseenter",ev=>showTip(ev,d,total));
  el.addEventListener("mousemove",moveTip);
  el.addEventListener("mouseleave",hideTip);
}

// ===== CSVパーサー（SBI / 楽天 両対応・Shift-JIS） =====
function parseCSVText(text){
  const rows=[]; let row=[], f="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; }
      else f+=c;
    }else{
      if(c==='"') q=true;
      else if(c===','){ row.push(f); f=""; }
      else if(c==='\r'){}
      else if(c==='\n'){ row.push(f); rows.push(row); row=[]; f=""; }
      else f+=c;
    }
  }
  if(f!==""||row.length){ row.push(f); rows.push(row); }
  return rows;
}
const num=s=>{ const v=parseFloat(String(s||"").replace(/[,\s円口"]/g,"").replace(/USD/gi,"")); return isNaN(v)?0:v; };

// 楽天形式
function parseRakuten(rows){
  const out=[];
  const catMap={"国内株式":"jp","米国株式":"us","中国株式":"us","アセアン株式":"us","投資信託":"fund"};
  let inTbl=false;
  for(const r of rows){
    if(r[0]==="種別"){ inTbl=true; continue; }
    if(!inTbl) continue;
    if(!r[0]||r[0].startsWith("■")) { if(r[0]&&r[0].startsWith("■")) break; continue; }
    if(r[0]==="外貨預り金"){                      // 外貨預り金（現金）も資産に含める
      const cv=num(r[14]);
      if(cv>0) out.push({ name:((r[2]||"米ドル").trim())+"（現金）", code:"現金", value:cv, cost:cv, cat:"cash", acct:"外貨預り金" });
      continue;
    }
    const cat=catMap[r[0]];
    if(!cat) continue;
    const value=num(r[14]), pl=num(r[16]);
    if(value<=0) continue;
    const isFund=(cat==="fund");
    out.push({ name:(r[2]||"").trim(), code:isFund?"投信":(r[1]||"").trim(), value, cost:value-pl, cat, acct:normAcct(r[3]), qty:num(r[4]) });
  }
  return out;
}

// 口座名の正規化（SBI・楽天共通）
function normAcct(s){
  s=(s||"").trim();
  if(s.includes("旧つみたて")) return "旧つみたてNISA";
  if(s.includes("つみたて")) return "NISA(つみたて)";
  if(s.includes("成長")) return "NISA(成長)";
  if(s.includes("特定")) return "特定";
  if(s.includes("一般")) return "一般";
  if(s==="-"||s==="") return "";
  return s;
}

// SBI形式
function parseSBI(rows){
  const out=[]; let mode=null, acct="";
  for(const r of rows){
    const first=(r[0]||"").trim();
    if(first.includes("預り")) acct=normAcct(first);   // セクション見出しから口座を取得
    if(first==="銘柄コード"){ mode="stock"; continue; }
    if(first==="ファンド名"){ mode="fund"; continue; }
    if(r.length<3){ mode=null; continue; }       // タイトル・合計行でリセット
    if(first==="評価額合計"){ mode=null; continue; }
    if(mode==="stock" && /^\d{3,4}$/.test(first)){
      const value=num(r[7]), cost=num(r[6]);
      if(value>0) out.push({name:(r[1]||"").trim(), code:first, value, cost, cat:"jp", acct, qty:num(r[2])});
    }else if(mode==="fund" && first){
      const value=num(r[6]), cost=num(r[5]);
      if(value>0) out.push({name:first, code:"投信", value, cost, cat:"fund", acct, qty:num(r[1])});
    }
  }
  return out;
}

// SBI外国株形式。株式＋預り金（外貨現金）に対応。外貨債券セクションはスキップ。
// 旧形式（株式一覧のみ）は先頭が株式ヘッダーなので stock で開始してそのまま動く。
function parseSBIForeign(rows){
  const out=[];
  let mode="stock";
  for(const r of rows){
    const first=(r[0]||"").trim();
    if(!first) continue;
    // セクション見出し・ヘッダー行でモードを切り替える
    if(first==="外国株式"){ mode="stock"; continue; }
    if(first==="外貨債券"||first==="外貨建債券"){ mode="bond"; continue; }
    if(first==="預り金"){ mode="cash"; continue; }
    if(first==="銘柄名"){ mode = r.includes("ティッカー") ? "stock" : "bond"; continue; }  // 株式/債券のヘッダー
    if(first==="通貨") continue;   // 預り金セクションのヘッダー
    if(mode==="stock"){
      if(r.length<13) continue;
      const value=num(r[12]), cost=num(r[10]);   // 評価額_円換算 / 取得金額_円換算
      if(value>0) out.push({ name:first, code:(r[1]||"").trim(), value, cost, cat:"us", acct:"外国株式", qty:num(r[5]) });
    }else if(mode==="cash"){
      const value=num(r[2]);   // 通貨,保有数量,円換算評価額
      if(value>0) out.push({ name:first+"（現金）", code:"現金", value, cost:value, cat:"cash", acct:"外貨預り金" });
    }else if(mode==="bond"){
      // 銘柄名,保有額面_USD,取得単価,取得為替,外貨建評価額_USD,円換算評価額
      const value=num(r[5]);
      if(value>0){
        const cost=Math.round(num(r[1])*num(r[2])/100*num(r[3]));  // 額面×取得単価%×取得為替
        out.push({ name:first, code:"債券", value, cost:cost>0?cost:value, cat:"bond", acct:"外貨建債券" });
      }
    }
  }
  return out;
}

// SBI外国株「保有証券一覧」画面をコピーしたテキストを取り込む（GPT変換を不要にする）
// 株式・外貨建債券・預り金の3セクションに対応。
function parseSBIForeignPaste(text){
  // 不可視文字・特殊空白を除去/正規化（コードポイントで判定。貼り付け失敗の主因）
  text=String(text).replace(/[\s\S]/g,ch=>{
    const c=ch.charCodeAt(0);
    if(c===0xFEFF||c===0x200B||c===0x200C||c===0x200D||c===0x2060) return "";  // BOM・ゼロ幅
    if(c===0x2028||c===0x2029) return "\n";                                    // 行・段落区切り
    if(c===0xA0||c===0x2007||c===0x202F||c===0x3000) return " ";               // NBSP・全角空白
    return ch;
  });
  // 空行を除いた行配列（プレーンテキスト形式は各値が空行で区切られる）
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length);
  const out=[];
  let mode="stock";
  const MKT=/^([A-Za-z][A-Za-z0-9.\-]*)(NYSE|NASDAQ|NYSEARCA|ARCA|AMEX|BATS|CBOE|OTC)$/;  // 例: BACNYSE
  const yenOf=s=>{ const m=s.match(/^([+\-]?[\d,]+)\s*円$/); return m?parseInt(m[1].replace(/[,+]/g,""),10):null; };
  const usdOf=s=>{ const m=s.match(/^([\d,]+(?:\.\d+)?)\s*USD$/); return m?parseFloat(m[1].replace(/,/g,"")):null; };
  const plainNum=s=>{ const m=s.match(/^([\d,]+(?:\.\d+)?)$/); return m?parseFloat(m[1].replace(/,/g,"")):null; };
  const HEADER=/^(銘柄|現在値|円換算額|保有数量|\(売却注文中\)|取得単価|取得金額|外貨建評価額|円換算評価額|外貨建評価損益|円換算評価損益|金額|%|取引|通貨|保有額面|取得為替|総評価合計|外貨建債券の表示について|現買|現売|積立|買付|売却)$/;
  const nameOf=s=>{ const md=s.match(/\[(.+?)\]/); return md?md[1]:s.replace(/^\*\s*/,"").trim(); };  // Markdownリンク/プレーン両対応

  for(let i=0;i<lines.length;i++){
    const ln=lines[i];
    if(/^外貨建債券/.test(ln)){ mode="bond"; continue; }
    if(/^預り金/.test(ln)){ mode="cash"; continue; }

    // 株式: ティッカー行（BACNYSE 等）を各銘柄の起点にし、直前の行を銘柄名とする
    if(mode==="stock"){
      const mt=ln.match(MKT);
      if(!mt) continue;
      const code=mt[1];
      const name=i>0 ? nameOf(lines[i-1]) : code;
      const yens=[]; let qty=null, j=i+1;
      for(; j<lines.length; j++){
        const l=lines[j];
        if(MKT.test(l) || /^外貨建債券|^預り金/.test(l)) break;
        const y=yenOf(l);
        if(y!==null) yens.push(y);
        else if(qty===null && /^\d{1,7}$/.test(l)) qty=parseInt(l,10);   // 保有数量（"(0)"は括弧付きで除外）
      }
      // yens = [現在値円, 取得単価円, 取得金額円, 円換算評価額, 円換算評価損益]
      if(yens.length>=4 && yens[3]>0)
        out.push({ name, code, value:yens[3], cost:yens[2], cat:"us", acct:"外国株式", qty:qty||0 });
      i=j-1;   // 次銘柄の直前（名前行）へ
      continue;
    }

    // 外貨建債券: ヘッダー語・数値・USD・ティッカー以外の行を銘柄名とみなす
    if(mode==="bond"){
      if(HEADER.test(ln) || usdOf(ln)!==null || yenOf(ln)!==null || plainNum(ln)!==null || MKT.test(ln)) continue;
      const name=nameOf(ln); const nums=[]; let valYen=null, j=i+1;
      for(; j<lines.length; j++){
        const l=lines[j];
        if(/^預り金/.test(l) || HEADER.test(l)) break;
        const y=yenOf(l); if(y!==null){ valYen=y; continue; }   // 円換算評価額
        const u=usdOf(l); if(u!==null){ nums.push(u); continue; }
        const n=plainNum(l); if(n!==null){ nums.push(n); continue; }
        break;   // 次の銘柄名などで終了
      }
      // nums = [保有額面USD, 取得単価, 取得為替, 外貨建評価額USD]
      if(valYen>0){
        const cost = nums.length>=3 ? Math.round(nums[0]*nums[1]/100*nums[2]) : valYen;
        out.push({ name, code:"債券", value:valYen, cost:cost>0?cost:valYen, cat:"bond", acct:"外貨建債券" });
      }
      i=j-1;
      continue;
    }

    // 預り金: 通貨名の行を起点に、円換算評価額を拾う
    if(mode==="cash"){
      if(HEADER.test(ln) || usdOf(ln)!==null || yenOf(ln)!==null || plainNum(ln)!==null) continue;
      const cur=nameOf(ln); let valYen=null, j=i+1;
      for(; j<lines.length; j++){
        const l=lines[j];
        const y=yenOf(l); if(y!==null){ valYen=y; break; }   // 円換算評価額を拾って終了
        if(MKT.test(l)) break;
      }
      if(valYen>0) out.push({ name:cur+"（現金）", code:"現金", value:valYen, cost:valYen, cat:"cash", acct:"外貨預り金" });
      i=j;
      continue;
    }
  }
  out.forEach(d=>d.broker="SBI");
  return out;
}

function parseCSV(text){
  const rows=parseCSVText(text);
  let out, broker="SBI";
  if(text.includes("保有商品詳細")||text.includes("銘柄コード・ティッカー")){ out=parseRakuten(rows); broker="楽天"; }
  else if(text.includes("評価額_円換算")||text.includes("ティッカー,市場")){ out=parseSBIForeign(rows); }  // SBI外国株
  else { out=parseSBI(rows); }
  out.forEach(d=>d.broker=broker);          // 証券会社を記録
  return out;
}

// 表記ゆれの正規化（全角英数→半角、スペース・中黒・＆を除去）
function normName(s){
  s=(s||"").replace(/[！-～]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0));
  return s.replace(/[\s　・･&]/g,"").toUpperCase();
}
// 同一銘柄の判定キー（コードがあるものはコード、投信・現金は正規化した名前）
function mergeKey(d){
  const hasCode=d.code && d.code!=="投信" && d.code!=="現金";
  return (hasCode ? d.code : normName(d.name))+"|"+d.cat;
}
const asciiCount=s=>(String(s).match(/[\x20-\x7e]/g)||[]).length;

// 同一銘柄を合算（証券会社をまたいで1銘柄にまとめる）
function mergeHoldings(arr){
  const map=new Map();
  for(const d of arr){
    const key=mergeKey(d);
    if(map.has(key)){
      const e=map.get(key);
      e.value+=d.value; e.cost+=d.cost; e.qty=(e.qty||0)+(d.qty||0);
      e.brokers.add(d.broker);
      if(asciiCount(d.name)>asciiCount(e.name)) e.name=d.name;  // 半角表記を優先
    }
    else { const e={...d}; e.brokers=new Set([d.broker]); map.set(key,e); }
  }
  return [...map.values()].map(e=>{
    e.brokers=[...e.brokers].filter(Boolean);
    e.multi=e.brokers.length>1;                 // 複数の証券会社で保有 → 展開可能
    e.broker=e.multi?null:e.brokers[0];
    return e;
  });
}

// 銘柄1つの証券会社別内訳（展開時の子行）
function brokerChildren(d){
  let base = curFilter==="all" ? RAW : RAW.filter(x=>x.cat===curFilter);
  const key=mergeKey(d);
  base = base.filter(x=>mergeKey(x)===key);
  const map=new Map();
  for(const x of base){
    const k=x.broker||"その他";
    if(map.has(k)){ const e=map.get(k); e.value+=x.value; e.cost+=x.cost; e.qty=(e.qty||0)+(x.qty||0); }
    else map.set(k,{name:k, code:x.code, cat:x.cat, value:x.value, cost:x.cost, qty:x.qty||0, broker:null});
  }
  return [...map.values()].sort((a,b)=>b.value-a.value);
}

function setData(arr){
  arr.forEach(classify);                        // セクター・景気・口座を付与
  RAW = arr.filter(d=>d.value>0);
  ALL = mergeHoldings(RAW).filter(d=>d.value>0);
  ALL.sort((a,b)=>b.value-a.value);
  ALL.forEach((d,i)=>{ d.color=palette[i%palette.length]; });
  // フィルターを全てにリセット
  curFilter="all";
  document.querySelectorAll(".fpill").forEach(x=>x.classList.toggle("on",x.dataset.cat==="all"));
  render();
}

// グルーピング軸のキー関数
function groupField(mode){
  return mode==="sector"?(d=>d.sector) : mode==="economic"?(d=>d.eco)
       : mode==="broker"?(d=>d.broker) : (d=>d.acct);
}
const GROUP_LABEL={individual:"個別",broker:"証券会社",sector:"セクター",economic:"景気影響",account:"口座"};

// グルーピング（セクター / 景気影響 / 口座 / 証券会社）
function groupBy(arr,mode){
  const keyFn = groupField(mode);
  const map=new Map();
  for(const d of arr){
    const k=keyFn(d)||"その他";
    let e=map.get(k);
    if(!e){ e={name:k, code:"group", value:0, cost:0, brands:new Set(), cat:d.cat}; map.set(k,e); }
    e.value+=d.value; e.cost+=d.cost; e.brands.add(mergeKey(d));  // 同一銘柄は1銘柄として数える
  }
  const out=[...map.values()];
  out.forEach(e=>{ e.count=e.brands.size; delete e.brands; });
  out.sort((a,b)=>b.value-a.value);
  const BROKER_COLOR={"SBI":"#2b53d6","楽天":"#d63838"};
  out.forEach((d,i)=>d.color=(mode==="broker"&&BROKER_COLOR[d.name])||palette[i%palette.length]);
  return out;
}

// 状態
let curFilter="all";
let curView="donut";
let otherPct=2;               // この%以下のスライスを[その他]に集約（0で無効）

// ラベルの折り返し（全角=1 / 半角=0.55 換算で1行8文字相当、最大2行）
function wrapLabel(s){
  const w=ch=>ch.charCodeAt(0)<256?0.55:1;
  const MAX=8, lines=[];
  let cur="", len=0;
  for(const ch of s){
    if(len+w(ch)>MAX){
      lines.push(cur); cur=""; len=0;
      if(lines.length===2){ lines[1]=lines[1].slice(0,-1)+"…"; return lines; }
    }
    cur+=ch; len+=w(ch);
  }
  if(cur) lines.push(cur);
  return lines;
}

function svgText(p,tgt){
  const t=document.createElementNS(NS,"text");
  for(const k in p){ if(k!=="t") t.setAttribute(k,p[k]); }
  t.textContent=p.t; (tgt||svg).appendChild(t); return t;
}

// ===== ドーナツ描画 =====
function renderDonut(data,total,totalCost,totalPL,totalPct){
  // 左右にラベル列の余白を確保しつつドーナツは大きく保つ
  svg.setAttribute("viewBox","-30 -10 580 460");
  const cx=260, cy=210, rOut=160, rIn=98;
  function arc(cx,cy,r,a0,a1){
    const p0=[cx+r*Math.cos(a0), cy+r*Math.sin(a0)];
    const p1=[cx+r*Math.cos(a1), cy+r*Math.sin(a1)];
    const large=(a1-a0)>Math.PI?1:0; return {p0,p1,large};
  }
  let ang=-Math.PI/2; const labelData=[];
  data.forEach(d=>{
    const frac=d.value/total;
    // 100%（銘柄1つ）だと始点=終点で円弧が消えるため、ごく僅かに欠けさせて描く
    const sweep=Math.min(frac*2*Math.PI, 2*Math.PI-0.0005);
    const a0=ang, a1=a0+sweep; ang+=frac*2*Math.PI;
    const o=arc(cx,cy,rOut,a0,a1), i=arc(cx,cy,rIn,a1,a0);
    const path=document.createElementNS(NS,"path");
    path.setAttribute("d",
      `M${o.p0[0]} ${o.p0[1]} A${rOut} ${rOut} 0 ${o.large} 1 ${o.p1[0]} ${o.p1[1]} `+
      `L${i.p0[0]} ${i.p0[1]} A${rIn} ${rIn} 0 ${o.large} 0 ${i.p1[0]} ${i.p1[1]} Z`);
    path.setAttribute("fill",d.color);
    path.setAttribute("stroke","#06070c");
    path.setAttribute("stroke-width","2.5");
    attachTip(path,d,total);
    if(d.code==="group"||d.multi){
      const key=d.code==="group" ? d.name : mergeKey(d);
      path.style.cursor="pointer";
      path.addEventListener("click",()=>{ drill = drill===key ? null : key; render(); });
    }
    svg.appendChild(path);
    if(frac*100>=3){
      const mid=(a0+a1)/2, lr=(rOut+rIn)/2;
      svgText({x:cx+lr*Math.cos(mid),y:cy+lr*Math.sin(mid),fill:"#10141a",
        "font-size":15,"font-weight":700,"font-family":"Sora","text-anchor":"middle",
        "dominant-baseline":"central",t:(frac*100).toFixed(1)});
    }
    labelData.push({d,mid:(a0+a1)/2,frac});
  });
  // 引き出しラベル（左右の列に整列・重なり自動回避・全文表示は折り返し）
  const sides={L:[],R:[]};
  labelData.filter(l=>l.frac*100>=3).forEach(l=>{
    const right=Math.cos(l.mid)>=0;
    const showCode=(l.d.code!=="投信"&&l.d.code!=="現金"&&l.d.code!=="group"&&l.d.code!=="other");
    const lines=wrapLabel(showCode?`${l.d.name}(${l.d.code})`:l.d.name);
    sides[right?"R":"L"].push({...l, right, lines, y:cy+(rOut+10)*Math.sin(l.mid)});
  });
  function spread(arr){
    arr.sort((a,b)=>a.y-b.y);
    const top=8, bot=430;
    for(let i=1;i<arr.length;i++){
      const need=arr[i-1].lines.length>1?34:22;   // 2行ラベルは間隔を広く
      if(arr[i].y-arr[i-1].y<need) arr[i].y=arr[i-1].y+need;
    }
    if(arr.length){
      const lastH=arr[arr.length-1].lines.length>1?13:0;
      const over=arr[arr.length-1].y+lastH-bot; if(over>0) arr.forEach(o=>o.y-=over);
      const under=top-arr[0].y;                 if(under>0) arr.forEach(o=>o.y+=under);
    }
  }
  spread(sides.L); spread(sides.R);
  function drawSide(arr){
    arr.forEach(l=>{
      const x1=cx+rOut*Math.cos(l.mid), y1=cy+rOut*Math.sin(l.mid);
      const xMid=cx+(rOut+14)*Math.cos(l.mid);
      const colX=l.right?416:104;          // ラベル列のドーナツ側端
      const line=document.createElementNS(NS,"polyline");
      line.setAttribute("points",`${x1},${y1} ${xMid},${l.y} ${colX},${l.y}`);
      line.setAttribute("fill","none");
      line.setAttribute("stroke",l.d.color);
      line.setAttribute("stroke-width","1.4");
      svg.appendChild(line);
      const dot=document.createElementNS(NS,"circle");
      dot.setAttribute("cx",colX);dot.setAttribute("cy",l.y);dot.setAttribute("r","2.6");
      dot.setAttribute("fill",l.d.color);svg.appendChild(dot);
      l.lines.forEach((ln,li)=>{
        svgText({x:l.right?colX+7:colX-7,y:l.y+li*13,fill:"#dfe3ea","font-size":12,"font-weight":600,
          "text-anchor":l.right?"start":"end","dominant-baseline":"central",t:ln});
      });
    });
  }
  drawSide(sides.L); drawSide(sides.R);
  // 中央
  const sg=totalPL>=0?"+":"", col=totalPL>=0?"#3ddc97":"#ff6b7a";
  svgText({x:cx,y:cy-26,fill:"#b9bfcc","font-size":14,"font-weight":600,"font-family":"Zen Kaku Gothic New","text-anchor":"middle",t:"総資産評価額"});
  svgText({x:cx,y:cy+4,fill:"#f6f1e4","font-size":27,"font-weight":800,"font-family":"Sora","text-anchor":"middle",t:fmt(total)+" 円"});
  svgText({x:cx,y:cy+30,fill:col,"font-size":16,"font-weight":700,"font-family":"Sora","text-anchor":"middle",t:`${sg}${fmt(totalPL)}円`});
  svgText({x:cx,y:cy+50,fill:col,"font-size":15,"font-weight":700,"font-family":"Sora","text-anchor":"middle",t:`(${sg}${totalPct.toFixed(1)}%)`});
}

// ===== ツリーマップ描画（squarified） =====
function renderTreemap(data,total){
  const W=520,H=440;
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  // 面積比でsquarify
  const items=data.map(d=>({d,area:d.value/total*W*H}));
  function worst(row,w){
    const s=row.reduce((a,b)=>a+b.area,0);
    const mx=Math.max(...row.map(r=>r.area)), mn=Math.min(...row.map(r=>r.area));
    return Math.max((w*w*mx)/(s*s),(s*s)/(w*w*mn));
  }
  let x=0,y=0,w=W,h=H, rest=items.slice(), row=[];
  const placed=[];
  function layoutRow(row,x,y,w,h,horizontal){
    const s=row.reduce((a,b)=>a+b.area,0);
    let off=0;
    row.forEach(r=>{
      if(horizontal){ const rh=r.area/s*h; placed.push({d:r.d,x,y:y+off,w,h:rh}); off+=rh; }
      else { const rw=r.area/s*w; placed.push({d:r.d,x:x+off,y,w:rw,h}); off+=rw; }
    });
  }
  while(rest.length){
    // 短辺に沿って行を作る（squarified簡易版）
    const len=Math.min(w,h);
    row=[]; let i=0;
    while(i<rest.length){
      const trial=row.concat([rest[i]]);
      if(row.length===0 || worst(trial,len)<=worst(row,len)){ row.push(rest[i]); i++; }
      else break;
    }
    const s=row.reduce((a,b)=>a+b.area,0);
    if(w>=h){ const rw=s/h; layoutRow(row,x,y,rw,h,true); x+=rw; w-=rw; }
    else { const rh=s/w; layoutRow(row,x,y,w,rh,false); y+=rh; h-=rh; }
    rest=rest.slice(row.length);
  }
  placed.forEach(p=>{
    const r=document.createElementNS(NS,"rect");
    r.setAttribute("x",p.x+1.5);r.setAttribute("y",p.y+1.5);
    r.setAttribute("width",Math.max(0,p.w-3));r.setAttribute("height",Math.max(0,p.h-3));
    r.setAttribute("rx",6);r.setAttribute("fill",p.d.color);
    attachTip(r,p.d,total);
    svg.appendChild(r);
    const pct=p.d.value/total*100;
    if(p.w>70&&p.h>34){
      const nm=p.d.name.length>10?p.d.name.slice(0,9)+"…":p.d.name;
      svgText({x:p.x+10,y:p.y+22,fill:"#10141a","font-size":13,"font-weight":700,"font-family":"Zen Kaku Gothic New",t:nm});
      svgText({x:p.x+10,y:p.y+40,fill:"#1a2230","font-size":12,"font-weight":700,"font-family":"Sora",t:pct.toFixed(1)+"%"});
    } else if(p.w>40&&p.h>20){
      svgText({x:p.x+6,y:p.y+18,fill:"#10141a","font-size":11,"font-weight":700,"font-family":"Sora",t:pct.toFixed(1)+"%"});
    }
  });
}

// ===== サマリー＆一覧 =====
function renderSidebar(data,total,totalCost,totalPL,totalPct){
  const maxVal=Math.max(...data.map(d=>d.value),1);
  const sign=totalPL>=0?"+":"";
  const empty=ALL.length===0;
  document.getElementById("summary").innerHTML=`
    <div class="stat"><div class="lab">${curFilter==="all"?"総資産評価額":"絞込 評価額"}</div><div class="num">${empty?'–':'¥'+fmt(total)}</div></div>
    <div class="stat"><div class="lab">取得金額</div><div class="num sm">${empty?'–':'¥'+fmt(totalCost)}</div></div>
    <div class="stat"><div class="lab">評価損益</div><div class="num sm ${totalPL>=0?'pos':'neg'}">${empty?'–':sign+'¥'+fmt(totalPL)}</div></div>
    <div class="stat"><div class="lab">損益率</div><div class="num ${totalPL>=0?'pos':'neg'}">${empty||!totalCost?'–':sign+totalPct.toFixed(1)+'%'}</div></div>`;
  const titleEl=document.getElementById("listTitle");
  const arrow=k=> sortKey===k ? (sortDir==="desc"?" ▼":" ▲") : "";
  titleEl.innerHTML=`<span class="ltitle">保有銘柄一覧</span>`+
    `<span class="sortctl">`+
    `<span class="sortlab">並び替え</span>`+
    `<button data-k="value" class="${sortKey==="value"?"on":""}">金額${arrow("value")}</button>`+
    `<button data-k="pl" class="${sortKey==="pl"?"on":""}">損益${arrow("pl")}</button>`+
    `<button data-k="name" class="${sortKey==="name"?"on":""}">名前${arrow("name")}</button>`+
    `</span><small id="cnt"></small>`;
  titleEl.querySelectorAll(".sortctl button").forEach(b=>{
    b.addEventListener("click",()=>{
      const k=b.dataset.k;
      if(sortKey===k){ sortDir = sortDir==="desc"?"asc":"desc"; }
      else { sortKey=k; sortDir = k==="name"?"asc":"desc"; }
      render();
    });
  });
  document.getElementById("cnt").textContent=
    `全${data.length}${groupMode==="individual"?"銘柄":"グループ"}`;
  const list=document.getElementById("list");
  list.innerHTML="";
  if(!data.length){
    const msg = ALL.length===0 ? "CSVを読み込むと、ここに保有銘柄が一覧表示されます" : "該当する銘柄はありません";
    list.innerHTML=`<div style="padding:48px 24px;text-align:center;color:#8a909c;font-size:14px;">${msg}</div>`;
    return;
  }
  // 1行を生成
  function buildRow(d,label,baseTotal,baseMax,child,expanded){
    const pl=d.value-d.cost, plp=d.cost?pl/d.cost*100:0;
    const cls=pl>=0?"pos":"neg", s=pl>=0?"+":"";
    const w=(d.value/baseMax*100).toFixed(1);
    const pct=(d.value/baseTotal*100).toFixed(1);
    const qtyTxt = (d.code!=="group"&&d.code!=="現金"&&d.qty>0)
      ? `・${fmt(d.qty)}${d.cat==="fund"?"口":"株"}` : "";
    const sub = d.code==="group"?d.count+"銘柄"
      :(d.code==="投信"?"投資信託":d.code==="現金"?"外貨預り金":d.code==="債券"?"外貨建債券":"証券コード "+esc(d.code))
        +qtyTxt
        +(d.multi?` <em class="bk bk-both">合計</em>`
          :(d.broker?` <em class="bk bk-${d.broker==="SBI"?"sbi":d.broker==="楽天"?"rk":"both"}">${d.broker}</em>`:""));
    const el=document.createElement("div");
    const openable=(d.code==="group"||d.multi)&&!child;
    el.className="row"+(child?" child":"")+(openable?" clickable":"");
    el.innerHTML=`
      <span class="rank">${openable?`<span class="caret${expanded?" open":""}">›</span>`:label}</span>
      <span class="dot" style="background:${d.color}"></span>
      <div class="nm"><b>${esc(d.name)}</b><span>${sub}</span></div>
      <div class="barwrap"><div class="bar"><i style="width:${w}%;background:${d.color}"></i></div></div>
      <span class="pct-chip">${pct}%</span>
      <div class="val"><b>¥${fmt(d.value)}</b>
        <span class="${cls}">${s}${fmt(pl)} (${s}${plp.toFixed(1)}%)</span></div>`;
    return el;
  }
  sortHoldings(data).forEach((d,idx)=>{
    const isGroup=(d.code==="group");
    const key=isGroup ? d.name : mergeKey(d);
    const expanded=(isGroup||d.multi) && drill===key;
    const el=buildRow(d, idx+1, total, maxVal, false, expanded);
    if(isGroup||d.multi){
      el.addEventListener("click",()=>{ drill = drill===key ? null : key; render(); });
    }
    list.appendChild(el);
    // 展開：グループは配下の銘柄、合算銘柄は証券会社別の内訳
    if(expanded){
      let kids;
      if(isGroup){
        const kf=groupField(groupMode);
        let base = curFilter==="all" ? RAW : RAW.filter(x=>x.cat===curFilter);
        base = base.filter(x=>(kf(x)||"その他")===d.name);
        kids=sortHoldings(mergeHoldings(base).filter(x=>x.value>0));
      }else{
        kids=brokerChildren(d);
      }
      const kMax=Math.max(...kids.map(x=>x.value),1);
      kids.forEach((kd,i)=>{ kd.color=d.color; list.appendChild(buildRow(kd, i+1, d.value, kMax, true, false)); });
    }
  });
}

// 並び替え（名前順 / 金額順 / 損益順）
function sortHoldings(arr){
  const dir = sortDir==="asc"?1:-1;
  const a=arr.slice();
  if(sortKey==="name")      a.sort((x,y)=>x.name.localeCompare(y.name,"ja")*dir);
  else if(sortKey==="pl")   a.sort((x,y)=>((x.value-x.cost)-(y.value-y.cost))*dir);
  else                      a.sort((x,y)=>(x.value-y.value)*dir);
  return a;
}

// ===== 再描画 =====
function render(){
  let data;
  if(groupMode==="individual"){
    data = curFilter==="all" ? ALL : ALL.filter(d=>d.cat===curFilter);
  }else{
    const base = curFilter==="all" ? RAW : RAW.filter(d=>d.cat===curFilter);
    data = groupBy(base, groupMode);   // ドーナツ・サマリーは常にグループ表示
  }
  const total=data.reduce((s,d)=>s+d.value,0);
  const totalCost=data.reduce((s,d)=>s+d.cost,0);
  const totalPL=total-totalCost;
  const totalPct=totalCost?totalPL/totalCost*100:0;
  // しきい値以下のスライスを[その他]へ集約（グラフのみ・一覧は全銘柄表示）
  let chartData=data;
  if(otherPct>0 && data.length>1 && total>0){
    const small=data.filter(d=>d.value/total*100<=otherPct);
    if(small.length>1){
      chartData=data.filter(d=>d.value/total*100>otherPct).concat([{
        name:"その他", code:"other",
        value:small.reduce((s,d)=>s+d.value,0),
        cost:small.reduce((s,d)=>s+d.cost,0),
        color:"#69707f"
      }]);
    }
  }
  svg.innerHTML="";
  hideTip();                          // 再描画時に出しっぱなしを防ぐ
  const gLabel=GROUP_LABEL[groupMode];
  document.getElementById("chartMode").textContent=
    (curView==="treemap"?"ツリーマップ":"ドーナツ")+" / "+(groupMode==="individual"?"個別":gLabel+"別");
  if(data.length===0){
    svg.setAttribute("viewBox","0 0 520 440");
    const msg = ALL.length===0 ? "右上の「CSV読込」からデータを読み込んでください" : "該当する銘柄はありません";
    svgText({x:260,y:210,fill:"#8a909c","font-size":15,"font-weight":600,"font-family":"Zen Kaku Gothic New","text-anchor":"middle",t:msg});
  } else if(curView==="treemap"){
    renderTreemap(chartData,total);
  } else {
    renderDonut(chartData,total,totalCost,totalPL,totalPct);
  }
  renderSidebar(data,total,totalCost,totalPL,totalPct);
}

// ===== イベント =====
// フィルター
document.querySelectorAll(".fpill").forEach(b=>{
  b.addEventListener("click",()=>{
    document.querySelectorAll(".fpill").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    curFilter=b.dataset.cat;
    drill=null;
    render();
  });
});
// [その他]集約スライダー
const othRange=document.getElementById("othRange");
const othCap=document.getElementById("othCap");
othRange.addEventListener("input",()=>{
  otherPct=parseFloat(othRange.value)||0;
  othCap.textContent = otherPct>0
    ? `[その他]にまとめる基準：${otherPct.toFixed(1)}%以下`
    : "[その他]にまとめる：無効";
  render();
});
// ツリーマップ / ドーナツ切替
const tmBtn=document.querySelector(".treemap-btn");
tmBtn.addEventListener("click",()=>{
  curView = curView==="donut" ? "treemap" : "donut";
  tmBtn.textContent = curView==="donut" ? "ツリーマップ" : "ドーナツ表示";
  render();
});
// 表示軸タブ（個別 / セクター / 景気影響 / 口座）
const GROUP_BY_LABEL={"個別":"individual","証券会社":"broker","セクター":"sector","景気影響":"economic","口座":"account"};
document.querySelectorAll(".seg button").forEach(b=>{
  b.addEventListener("click",()=>{
    document.querySelectorAll(".seg button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    groupMode = GROUP_BY_LABEL[b.textContent.trim()] || "individual";
    drill=null;
    render();
  });
});

// CSV読み込み（SBI / 楽天・複数可・Shift-JIS）
// 同じ種別（SBI/楽天/SBI外国株）のファイルは最新の読み込みで置き換え、二重計上を防ぐ
document.getElementById("file").addEventListener("change",async(e)=>{
  const files=[...e.target.files];
  if(!files.length) return;
  const srcEl=document.getElementById("src");
  srcEl.textContent="読み込み中…";
  const failed=[];
  for(const f of files){
    try{
      const buf=await f.arrayBuffer();
      // UTF-8として妥当ならUTF-8、不正バイトがあればShift-JIS（証券会社CSVはどちらもあり得る）
      let text;
      try{ text=new TextDecoder("utf-8",{fatal:true}).decode(buf); }
      catch{ text=new TextDecoder("shift-jis").decode(buf); }
      const parsed=parseCSV(text);
      const kind=text.includes("保有商品詳細")?"楽天":(text.includes("評価額_円換算")?"SBI外国株":"SBI");
      if(!parsed.length){ failed.push(`${f.name}（銘柄0件）`); continue; }  // 空の読み込みで既存データを消さない
      const fd=fileDate(f.name,text);   // ファイル名・内容から基準日を推定
      const dummy=/dummy|demo|sample/i.test(f.name);   // デモ用ファイルは推移に記録しない
      LOADED.set(kind,{
        label:`${f.name}（${kind}:${parsed.length}件）`,
        rows:parsed, date:fd, dummy,
        weak:fd?null:(f.lastModified?isoLocal(f.lastModified):null)
      });
    }catch(err){ failed.push(`${f.name}（読込失敗）`); }
  }
  rebuildFromLoaded(failed);   // 蓄積した全種別から再集計
  e.target.value="";
});

// LOADED（種別ごとの読み込み結果）からポートフォリオを再構成する共通処理
function rebuildFromLoaded(failed){
  failed=failed||[];
  RAW=[]; const labels=[], strong=[], weak=[];
  for(const v of LOADED.values()){
    RAW=RAW.concat(v.rows); labels.push(v.label);
    if(v.date) strong.push(v.date); else if(v.weak) weak.push(v.weak);
  }
  loadedNames=labels.concat(failed);
  const srcEl=document.getElementById("src");
  if(RAW.length){
    setData(RAW);
    const anyDummy=[...LOADED.values()].some(v=>v.dummy);   // 1つでもデモなら推移に記録しない
    const dataDate=strong.length ? strong.reduce((a,b)=>a>b?a:b)
                 : (weak.length ? weak.reduce((a,b)=>a>b?a:b) : null);
    if(!anyDummy) saveSnapshot(dataDate);   // 資産推移にデータ基準日で記録（デモ時はスキップ）
    srcEl.textContent=loadedNames.join(" / ")
      +(anyDummy?"｜デモ（推移に記録しません）":(dataDate?`｜基準日 ${dataDate.replace(/-/g,"/")}`:""));
    srcEl.style.color="#dfe3ea";
  }else{
    srcEl.textContent=failed.length?failed.join(" / "):"保有銘柄を検出できませんでした";
  }
}

// SBI外国株の画面コピーを取り込む（貼り付けモーダルから呼ぶ）
function importForeignPaste(text){
  const parsed=parseSBIForeignPaste(text);
  if(!parsed.length) return 0;
  const dummy=/dummy|demo|sample/i.test(text);
  LOADED.set("SBI外国株",{
    label:`貼り付け（SBI外国株:${parsed.length}件）`,
    rows:parsed, date:null, dummy,
    weak:isoLocal()   // 画面コピーには日付が無いので今日を基準日に
  });
  rebuildFromLoaded([]);
  return parsed.length;
}

// SBI外国株 貼り付けモーダル
const pasteModal=document.getElementById("pasteModal");
const pasteArea=document.getElementById("pasteArea");
document.getElementById("pasteBtn").addEventListener("click",()=>{
  pasteArea.value=""; pasteModal.hidden=false; pasteArea.focus();
});
document.getElementById("pasteClose").addEventListener("click",()=>{ pasteModal.hidden=true; });
pasteModal.addEventListener("click",e=>{ if(e.target===pasteModal) pasteModal.hidden=true; });  // 背景クリックで閉じる
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!pasteModal.hidden) pasteModal.hidden=true; });
document.getElementById("pasteRun").addEventListener("click",()=>{
  const n=importForeignPaste(pasteArea.value);
  if(n>0){ pasteModal.hidden=true; }
  else alert("SBI外国株の保有情報を読み取れませんでした。\n外国株「保有証券一覧」画面の一覧部分をコピーして貼り付けてください。");
});

// データリセット
document.getElementById("reset").addEventListener("click",()=>{
  RAW=[]; loadedNames=[]; LOADED.clear();
  setData([]);
  curView="donut";
  document.querySelector(".treemap-btn").textContent="ツリーマップ";
  const srcEl=document.getElementById("src");
  srcEl.textContent="CSV未読み込み";
  srcEl.style.color="";
});

// ===== 資産推移（CSV読込時にブラウザへ自動記録） =====
const HIST_KEY="kabu_asset_history_v1";
let histLocalWrite=false;   // 起動後に手元で履歴を書き換えたか（DBからの読み戻しで上書きしないため）
const histSvg=document.getElementById("histSvg");

function loadHist(){
  try{ const a=JSON.parse(localStorage.getItem(HIST_KEY)); return Array.isArray(a)?a:[]; }
  catch{ return []; }
}

const pad2=n=>String(n).padStart(2,"0");
// ローカル時刻基準のYYYY-MM-DD（toISOStringはUTCで日付がずれるため使わない）
function isoLocal(t){
  const d=t?new Date(t):new Date();
  return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
}
function validDate(s){
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return false;
  const mo=+m[2], dy=+m[3];
  return mo>=1&&mo<=12&&dy>=1&&dy<=31&&s<=isoLocal();
}
// ファイル名 → CSV冒頭 の順でデータ基準日を推定（見つからなければnull）
function fileDate(name,text){
  let m=name.match(/20\d{6}/);
  if(m){ const s=m[0], d=s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8); if(validDate(d)) return d; }
  m=name.match(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if(m){ const d=m[1]+"-"+pad2(m[2])+"-"+pad2(m[3]); if(validDate(d)) return d; }
  m=text.slice(0,2000).match(/(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/);
  if(m){ const d=m[1]+"-"+pad2(m[2])+"-"+pad2(m[3]); if(validDate(d)) return d; }
  return null;
}
let LOADED=new Map();  // 種別(SBI/楽天/SBI外国株) → {label, rows, date, weak}

function saveSnapshot(dateStr){
  if(!RAW.length) return;
  const total=RAW.reduce((s,d)=>s+d.value,0);
  const cost =RAW.reduce((s,d)=>s+d.cost,0);
  const day=dateStr||isoLocal();
  const hist=loadHist().filter(h=>h.date!==day);   // 同日の記録は上書き
  hist.push({date:day,total,cost});
  hist.sort((a,b)=>a.date.localeCompare(b.date));
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(hist)); }catch{}
  renderHistory();
  histLocalWrite=true;                             // 読み戻しより手元の読み込みを優先する
  sbSaveSnapshot({date:day,total,cost,rows:RAW});   // DB保存は待たない（描画をネットワークに引きずられないため）
}

let histRange=0;   // 表示期間（月数、0=全期間）
let HPTS=[];       // ホバー検索用の点座標

function histFiltered(){
  const hist=loadHist();
  if(!histRange) return hist;
  const c=new Date(); c.setMonth(c.getMonth()-histRange);
  const cut=isoLocal(c.getTime());   // UTC変換だと日付境界がずれるためローカル基準
  return hist.filter(h=>h.date>=cut);
}

// 詳細バー（日付・資産残高・評価損益）の表示更新
function histShow(h){
  const dEl=document.getElementById("hDate"),
        tEl=document.getElementById("hTotal"),
        pEl=document.getElementById("hPL"),
        rEl=document.getElementById("hPLp");
  if(!h){
    dEl.textContent="–"; tEl.textContent="–";
    pEl.textContent="–"; rEl.textContent="";
    pEl.className=""; rEl.className="";
    return;
  }
  const pl=h.total-h.cost, pct=h.cost?pl/h.cost*100:0, sg=pl>=0?"+":"";
  dEl.textContent=h.date.replace(/-/g,"/");
  tEl.textContent=fmt(h.total)+"円";
  pEl.textContent=sg+fmt(pl)+"円";
  rEl.textContent=sg+pct.toFixed(2)+"%";
  pEl.className=pl>=0?"pos":"neg";
  rEl.className=pl>=0?"pos":"neg";
}

// 軸の上限をキリのよい値に切り上げ
function niceCeil(v){
  if(v<=0) return 1;
  const p=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/p;
  const m=n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10;
  return m*p;
}

function renderHistory(){
  const all=loadHist();
  const hist=histFiltered();
  const info=document.getElementById("histInfo");
  const rangeEl=document.getElementById("hRange");
  histSvg.innerHTML=""; HPTS=[];
  const W=1040,H=320,padL=24,padR=92,padT=26,padB=42;
  histSvg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  // 前回比（全期間の最新2件で計算）
  if(all.length>=2){
    const d=all[all.length-1].total-all[all.length-2].total, sg=d>=0?"+":"";
    info.textContent=`前回比 ${sg}${fmt(d)}円`;
    info.classList.toggle("pos",d>=0); info.classList.toggle("neg",d<0);
  }else{
    info.textContent=all.length?"記録1件目（次回の読み込みから折れ線になります）":"";
    info.classList.remove("pos","neg");
  }
  rangeEl.textContent=hist.length
    ? hist[0].date.replace(/-/g,"/")+" ～ "+hist[hist.length-1].date.replace(/-/g,"/") : "";
  if(!hist.length){
    histShow(null);
    svgText({x:W/2,y:H/2,fill:"#8a909c","font-size":14,"font-weight":600,
      "font-family":"Zen Kaku Gothic New","text-anchor":"middle",
      t: all.length ? "この期間の記録はありません"
                    : "CSVを読み込むと自動で記録され、資産の推移がここに表示されます"},histSvg);
    return;
  }
  const last=hist[hist.length-1];
  histShow(last);
  // スケール（Xは日付、Yは0円起点・右軸）
  const t0=new Date(hist[0].date).getTime();
  const span=Math.max(new Date(last.date).getTime()-t0,1);
  const X=h=>padL+((new Date(h.date).getTime()-t0)/span)*(W-padL-padR);
  const top=niceCeil(Math.max(...hist.map(h=>Math.max(h.total,h.cost)))*1.05);
  const Y=v=>padT+(1-v/top)*(H-padT-padB);
  histSvg.innerHTML=
    `<defs><linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1">`+
    `<stop offset="0" stop-color="#5bc6d8" stop-opacity=".30"/>`+
    `<stop offset="1" stop-color="#5bc6d8" stop-opacity=".04"/></linearGradient></defs>`;
  // 横グリッド＋右側の金額目盛り
  for(let i=0;i<=4;i++){
    const v=top*i/4, y=Y(v);
    const ln=document.createElementNS(NS,"line");
    ln.setAttribute("x1",padL);ln.setAttribute("x2",W-padR);
    ln.setAttribute("y1",y);ln.setAttribute("y2",y);
    ln.setAttribute("stroke","#1c2030");
    histSvg.appendChild(ln);
    svgText({x:W-padR+10,y,fill:"#7e8496","font-size":11.5,"font-family":"Sora",
      "text-anchor":"start","dominant-baseline":"central",
      t: v===0 ? "0円" : fmt(Math.round(v/10000))+"万円"},histSvg);
  }
  // 日付ラベル（YY/MM・間引いて最大6個程度）
  const step=Math.max(1,Math.ceil(hist.length/6));
  hist.forEach((h,i)=>{
    if(i%step!==0 && i!==hist.length-1) return;
    svgText({x:X(h),y:H-padB+20,fill:"#7e8496","font-size":11,"font-family":"Sora",
      "text-anchor":"middle",t:h.date.slice(2,7).replace("-","/")},histSvg);
  });
  const y0=Y(0);
  const ptsT=hist.map(h=>`${X(h)},${Y(h.total)}`);
  const ptsC=hist.map(h=>`${X(h)},${Y(h.cost)}`);
  if(hist.length>=2){
    // 取得金額（元本）の面
    const area=document.createElementNS(NS,"path");
    area.setAttribute("d",`M${ptsC.join(" L")} L${X(last)},${y0} L${X(hist[0])},${y0} Z`);
    area.setAttribute("fill","url(#hgrad)");
    histSvg.appendChild(area);
    const lc=document.createElementNS(NS,"polyline");
    lc.setAttribute("points",ptsC.join(" "));
    lc.setAttribute("fill","none");lc.setAttribute("stroke","#5bc6d8");
    lc.setAttribute("stroke-width","1.5");lc.setAttribute("stroke-opacity",".7");
    histSvg.appendChild(lc);
    // 評価額（実線）
    const lt=document.createElementNS(NS,"polyline");
    lt.setAttribute("points",ptsT.join(" "));
    lt.setAttribute("fill","none");lt.setAttribute("stroke","#e3c477");
    lt.setAttribute("stroke-width","2.6");
    lt.setAttribute("stroke-linejoin","round");lt.setAttribute("stroke-linecap","round");
    histSvg.appendChild(lt);
  }
  // 記録点＋ホバー座標の登録
  hist.forEach(h=>{
    const x=X(h), y=Y(h.total);
    HPTS.push({x,y,h});
    const c=document.createElementNS(NS,"circle");
    c.setAttribute("cx",x);c.setAttribute("cy",y);
    c.setAttribute("r",h===last?4.5:3);
    c.setAttribute("fill","#e3c477");
    c.setAttribute("stroke","#06070c");c.setAttribute("stroke-width","1.5");
    histSvg.appendChild(c);
  });
  // ホバー用クロスヘア（mousemoveで移動）
  const cross=document.createElementNS(NS,"line");
  cross.setAttribute("id","hCross");
  cross.setAttribute("y1",padT);cross.setAttribute("y2",H-padB);
  cross.setAttribute("stroke","#e3c477");cross.setAttribute("stroke-width","1.2");
  cross.setAttribute("stroke-dasharray","3 3");cross.style.display="none";
  histSvg.appendChild(cross);
  const cdot=document.createElementNS(NS,"circle");
  cdot.setAttribute("id","hCursorDot");
  cdot.setAttribute("r","5.5");cdot.setAttribute("fill","none");
  cdot.setAttribute("stroke","#f6e3a9");cdot.setAttribute("stroke-width","2");
  cdot.style.display="none";
  histSvg.appendChild(cdot);
  // 凡例
  svgText({x:padL,y:12,fill:"#e3c477","font-size":11.5,"font-weight":600,
    "font-family":"Zen Kaku Gothic New",t:"― 評価額"},histSvg);
  svgText({x:padL+78,y:12,fill:"#5bc6d8","font-size":11.5,"font-weight":600,
    "font-family":"Zen Kaku Gothic New",t:"▨ 取得金額（元本）"},histSvg);
}

// 履歴クリア
document.getElementById("histClear").addEventListener("click",()=>{
  if(!loadHist().length) return;
  if(confirm("資産推移の記録をすべて削除しますか？（Supabaseの記録も削除されます）")){
    localStorage.removeItem(HIST_KEY);
    renderHistory();
    histLocalWrite=true;                             // 読み戻しで消した履歴が復活しないようにする
    sbDeleteAll();
  }
});

// 期間切替（直近3ヶ月 / 半年 / 1年 / 全期間）
document.querySelectorAll(".hseg button").forEach(b=>{
  b.addEventListener("click",()=>{
    document.querySelectorAll(".hseg button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    histRange=parseInt(b.dataset.r,10)||0;
    renderHistory();
  });
});

// グラフ上のホバーで縦線カーソル＋詳細バー更新＋カード表示
histSvg.addEventListener("mousemove",e=>{
  if(!HPTS.length){ hideTip(); return; }
  const r=histSvg.getBoundingClientRect();
  const x=(e.clientX-r.left)/r.width*1040;
  let best=HPTS[0];
  for(const p of HPTS) if(Math.abs(p.x-x)<Math.abs(best.x-x)) best=p;
  const ch=document.getElementById("hCross"), cd=document.getElementById("hCursorDot");
  if(ch){ ch.setAttribute("x1",best.x); ch.setAttribute("x2",best.x); ch.style.display=""; }
  if(cd){ cd.setAttribute("cx",best.x); cd.setAttribute("cy",best.y); cd.style.display=""; }
  histShow(best.h);
  tipEl.innerHTML=histTipHTML(best.h);   // マウス位置にカード表示
  tipEl.style.display="block";
  moveTip(e);
});
histSvg.addEventListener("mouseleave",()=>{
  const ch=document.getElementById("hCross"), cd=document.getElementById("hCursorDot");
  if(ch) ch.style.display="none";
  if(cd) cd.style.display="none";
  hideTip();
  const f=histFiltered();
  histShow(f[f.length-1]||null);
});

// 特定日の推移記録を削除（デモ記録の除去用）
function delHistoryDay(day){
  const h=loadHist();
  if(!h.some(x=>x.date===day)) return false;
  localStorage.setItem(HIST_KEY, JSON.stringify(h.filter(x=>x.date!==day)));
  histLocalWrite=true;                             // 読み戻しで消した記録が復活しないようにする
  sbDeleteDay(day);
  return true;
}
// URLに ?del=YYYY-MM-DD があれば、その日の記録を確認のうえ削除する
// 例）portfolio_app.html?del=2026-07-22
(function(){
  const m=location.search.match(/[?&]del=(\d{4}-\d{2}-\d{2})/);
  if(!m) return;
  const day=m[1];
  if(loadHist().some(x=>x.date===day)){
    if(confirm(day+" の資産推移の記録を削除しますか？")){
      delHistoryDay(day);
      alert(day+" の記録を削除しました。");
    }
  }else{
    alert(day+" の記録は見つかりませんでした（すでに削除済みかもしれません）。");
  }
})();

// 初期表示は空（推移は保存済みの記録を表示）
setData([]);
renderHistory();

// Supabaseから資産推移を読み戻す。localStorageは同期キャッシュ扱いで、
// 取得できたらその内容で置き換えて描画し直す。ステータス表示は supabase.js 側が更新する。
(async function hydrateFromDB(){
  if(!sbEnabled()) return;          // 未設定時は supabase.js 側で「DB未設定」表示済み
  const rows=await sbLoadHistory();
  if(histLocalWrite) return;        // 取得を待つ間にCSVを読み込んだ → そちらが新しいので上書きしない
  if(!rows||!rows.length) return;   // 取得失敗、またはDBが空 → localStorageの内容を残す
  try{ localStorage.setItem(HIST_KEY,JSON.stringify(rows)); }catch{}
  renderHistory();
})();
