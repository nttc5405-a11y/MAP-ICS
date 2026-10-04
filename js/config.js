/* 設定：底圖、案件類型、區域類別。要換底圖網址、顏色，只改這個檔。 */
const CFG = {
  VERSION: '0.1.0',
  DEFAULT_CENTER: [22.75, 121.15],   // 台東縣
  DEFAULT_ZOOM: 10,
  POLL_MS: 30000,                    // 指揮所每 30 秒查一次版本號
  GEOJSON_LIMIT: 45000,              // 單格上限 50,000，系統保留到 45,000
  CELL_MAX: 50000,
  CIRCLE_POINTS: 72,                 // 圓形匯出 KML 時轉成幾邊形

  // 底圖（url 的 {z}{x}{y} 由 Leaflet 代入）
  BASEMAPS: [
    { id: 'emap', name: '通用版電子地圖',
      url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}',
      attr: '© 內政部國土測繪中心', maxZoom: 19, maxNativeZoom: 19 },
    { id: 'photo', name: '正射影像',
      url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}',
      attr: '© 內政部國土測繪中心', maxZoom: 19, maxNativeZoom: 19 },
    { id: 'rudy', name: '魯地圖',
      url: 'https://rudy.tile.basecamp.tw/{z}/{x}/{y}.png',
      attr: '© 魯地圖 Rudy / OpenStreetMap', maxZoom: 19, maxNativeZoom: 17 },
    { id: 'rudy-lite', name: '魯地圖清爽版',
      url: 'https://tile.happyman.idv.tw/map/moi_osm/{z}/{x}/{y}.png',
      attr: '© Happyman / OpenStreetMap', maxZoom: 19, maxNativeZoom: 16 },
    { id: 'osm', name: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '© OpenStreetMap contributors', maxZoom: 19, maxNativeZoom: 19 }
  ],
  DEFAULT_BASEMAP: 'emap',

  // 疊加圖層
  OVERLAYS: [
    { id: 'happyman-track', name: 'Happyman 航跡',
      url: 'https://tile.happyman.idv.tw/map/moi_osm_gpx/{z}/{x}/{y}.png',
      attr: '© Happyman', maxZoom: 19, maxNativeZoom: 16, opacity: 0.9 }
  ],

  CASE_TYPES: [
    { id: '山域', color: '#2e7d32' },
    { id: '水域', color: '#0277bd' },
    { id: '火警', color: '#d32f2f' },
    { id: '化災', color: '#f9a825' },
    { id: '其他', color: '#616161' }
  ],

  // 區域類別：color 為預設顏色
  ZONE_CATS: [
    { id: '熱區', color: '#d32f2f' },
    { id: '暖區', color: '#f9a825' },
    { id: '冷區', color: '#1976d2' },
    { id: '搜索區', color: '#7b1fa2' },
    { id: '警戒範圍', color: '#ef6c00' },
    { id: '路線／軌跡', color: '#00897b' },
    { id: '最後已知位置', color: '#c2185b' },
    { id: '指揮所', color: '#263238' },
    { id: '集結點', color: '#2e7d32' },
    { id: '直升機起降點', color: '#6a1b9a' },
    { id: '計畫路線', color: '#00897b' },
    { id: '搜索軌跡', color: '#1e88e5' },
    { id: '參考軌跡', color: '#8d6e63' },
    { id: '匯入資料', color: '#546e7a' },
    { id: '其他', color: '#757575' }
  ],

  // 危險因子快選（可在區域屬性裡點選加入）
  HAZARDS: ['落石', '濕滑', '陡坡／斷崖', '急流', '深水', '強風', '高溫', '爆炸危險',
            '有毒氣體', '電線', '結構不穩', '野生動物', '訊號不良'],

  // 任務狀態（順序即流程）：time 為任務物件上記錄該狀態時間的欄位
  TASK_STATUS: [
    { id: '已派遣', color: '#d32f2f', time: 'tAssigned' },
    { id: '已接收', color: '#8e24aa', time: 'tReceived' },
    { id: '已抵達', color: '#1976d2', time: 'tArrived' },
    { id: '執行中', color: '#ef6c00', time: 'tRunning' },
    { id: '完成', color: '#2e7d32', time: 'tDone' },
    { id: '需支援', color: '#b71c1c', time: 'tSupport' }
  ],
  UNIT_STATUS: [
    { id: '待命', color: '#546e7a' },
    { id: '執行中', color: '#ef6c00' },
    { id: '撤離', color: '#9e9e9e' }
  ],
  // 山域模組
  SEARCH_STATUS: ['未搜', '搜索中', '已搜'],
  TRACK_CATS: ['計畫路線', '搜索軌跡', '參考軌跡'],
  COVER_BUFFER_M: 50,      // 搜索軌跡兩側各 50 m 視為已搜索範圍
  // 檢傷分級
  TRIAGE: [
    { id: '紅', color: '#d32f2f', text: '立即', field: 'red' },
    { id: '黃', color: '#f9a825', text: '延遲', field: 'yellow' },
    { id: '綠', color: '#2e7d32', text: '輕傷', field: 'green' },
    { id: '黑', color: '#212121', text: '死亡／無生命徵象', field: 'black' }
  ],
  // 後送流程（順序即流程）：time 為記錄該階段時間的欄位
  TRANSPORT: [
    { id: '發現', time: 'tFound' },
    { id: '處置', time: 'tTreated' },
    { id: '後送中', time: 'tTransporting' },
    { id: '已到院', time: 'tArrived' }
  ],
  CASUALTY_QUICKS: ['意識清楚', '無意識', '出血', '骨折', '失溫', '呼吸困難', '外傷', '燒燙傷', '中暑', '脫水', '無法行走'],
  UNIT_CATS: ['分隊', '義消', '外部支援'],

  GEOM_NAMES: { Point: '標記點', LineString: '線', Polygon: '面', Circle: '圓' },

  STATUS_OPEN: '進行中',
  STATUS_CLOSED: '已結案'
};

CFG.typeColor = function (t) {
  const f = CFG.CASE_TYPES.find(x => x.id === t);
  return f ? f.color : '#616161';
};
CFG.triageColor = function (t) {
  const f = CFG.TRIAGE.find(x => x.id === t);
  return f ? f.color : '#757575';
};
CFG.taskColor = function (s) {
  const f = CFG.TASK_STATUS.find(x => x.id === s);
  return f ? f.color : '#757575';
};
CFG.unitColor = function (s) {
  const f = CFG.UNIT_STATUS.find(x => x.id === s);
  return f ? f.color : '#546e7a';
};
CFG.catColor = function (c) {
  const f = CFG.ZONE_CATS.find(x => x.id === c);
  return f ? f.color : '#757575';
};
